// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import "../libraries/Errors.sol";

import {SpotTradingRewardDistributorStorage} from "./SpotTradingRewardDistributorStorage.sol";
import {BIG_TIMELOCK_ADMIN, MEDIUM_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN, PM_ROLE, USD} from "../Constants.sol";
import {ISpotTradingRewardDistributorV2, IPausable} from "./ISpotTradingRewardDistributor.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";
import {ITraderBalanceVault} from "../TraderBalanceVault/ITraderBalanceVault.sol";
import {ITreasury} from "../Treasury/ITreasury.sol";

contract SpotTradingRewardDistributor is ISpotTradingRewardDistributorV2, SpotTradingRewardDistributorStorage {
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Throws if caller is not granted with _role
     * @param _role The role that is being checked for a function caller
     */
    modifier onlyRole(bytes32 _role) {
        _require(IAccessControl(registry).hasRole(_role, msg.sender), Errors.FORBIDDEN.selector);
        _;
    }

    /**
     * @inheritdoc ISpotTradingRewardDistributorV2
     */
    function initialize(
        address _registry,
        uint256 _periodDuration,
        address _priceOracle,
        address _pmx,
        address payable _traderBalanceVault,
        address _treasury
    ) external override initializer {
        _require(
            IERC165Upgradeable(_registry).supportsInterface(type(IAccessControl).interfaceId) &&
                IERC165Upgradeable(_priceOracle).supportsInterface(type(IPriceOracleV2).interfaceId) &&
                IERC165Upgradeable(address(_traderBalanceVault)).supportsInterface(
                    type(ITraderBalanceVault).interfaceId
                ) &&
                IERC165Upgradeable(_pmx).supportsInterface(type(IERC20).interfaceId) &&
                IERC165Upgradeable(_treasury).supportsInterface(type(ITreasury).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        _require(_periodDuration > 0, Errors.PERIOD_DURATION_IS_ZERO.selector);
        registry = _registry;
        initialPeriodTimestamp = block.timestamp;
        periodDuration = _periodDuration;
        priceOracle = _priceOracle;
        pmx = _pmx;
        traderBalanceVault = _traderBalanceVault;
        treasury = _treasury;
        __ERC165_init();
        __ReentrancyGuard_init();
        __Pausable_init();
    }

    /**
     * @inheritdoc ISpotTradingRewardDistributorV2
     */
    function updateTraderActivity(
        address trader,
        address positionAsset,
        uint256 positionAmount,
        bytes calldata positionUsdOracleData
    ) external override onlyRole(PM_ROLE) {
        uint256 currentPeriod = _getCurrentPeriod(block.timestamp);
        PeriodInfo storage periodInfo = periods[currentPeriod];

        if (periodInfo.totalReward == 0) {
            if (rewardPerPeriod == 0 || rewardPerPeriod > undistributedPMX) {
                return;
            }
            undistributedPMX -= rewardPerPeriod;
            periodInfo.totalReward = rewardPerPeriod;
        }

        uint256 positionSizeInUsd = PrimexPricingLibrary.getOracleAmountsOut(
            positionAsset,
            USD,
            positionAmount,
            priceOracle,
            positionUsdOracleData
        );

        periodInfo.traderActivity[trader] += positionSizeInUsd;
        periodInfo.totalActivity += positionSizeInUsd;

        if (
            periodsWithTraderActivity[trader].length == 0 ||
            periodsWithTraderActivity[trader][periodsWithTraderActivity[trader].length - 1] != currentPeriod
        ) {
            periodsWithTraderActivity[trader].push(currentPeriod);
        }
    }

    /**
     * @inheritdoc IPausable
     */
    function pause() external override onlyRole(EMERGENCY_ADMIN) {
        _pause();
    }

    /**
     * @inheritdoc IPausable
     */
    function unpause() external override onlyRole(SMALL_TIMELOCK_ADMIN) {
        _unpause();
    }

    /**
     * @inheritdoc ISpotTradingRewardDistributorV2
     */
    function setRewardPerPeriod(uint256 _rewardPerPeriod) external override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        rewardPerPeriod = _rewardPerPeriod;
        emit RewardPerPeriodChanged(_rewardPerPeriod);
    }

    /**
     * @inheritdoc ISpotTradingRewardDistributorV2
     */
    function decreaseRewardPerPeriod(uint256 _rewardPerPeriod) external override onlyRole(EMERGENCY_ADMIN) {
        _require(_rewardPerPeriod < rewardPerPeriod, Errors.REWARD_PER_PERIOD_IS_NOT_CORRECT.selector);
        rewardPerPeriod = _rewardPerPeriod;
        emit RewardPerPeriodDecreased(_rewardPerPeriod);
    }

    /**
     * @inheritdoc ISpotTradingRewardDistributorV2
     */
    function claimReward() external override nonReentrant whenNotPaused {
        (uint256 reward, uint256 currentPeriod) = calculateReward(msg.sender);
        _require(reward > 0, Errors.REWARD_AMOUNT_IS_ZERO.selector);
        uint256[] memory periodNumbers = periodsWithTraderActivity[msg.sender];
        delete periodsWithTraderActivity[msg.sender];

        if (periodNumbers[periodNumbers.length - 1] == currentPeriod) {
            periodsWithTraderActivity[msg.sender].push(currentPeriod);
        }

        IERC20(pmx).transfer(address(traderBalanceVault), reward);
        ITraderBalanceVault(traderBalanceVault).topUpAvailableBalance(msg.sender, address(pmx), reward);

        emit SpotTradingClaimReward(msg.sender, reward);
    }

    /**
     * @inheritdoc ISpotTradingRewardDistributorV2
     */
    function topUpUndistributedPmxBalance(uint256 amount) external override nonReentrant {
        undistributedPMX += amount;
        IERC20(pmx).transferFrom(msg.sender, address(this), amount);
        emit TopUpUndistributedPmxBalance(amount);
    }

    /**
     * @inheritdoc ISpotTradingRewardDistributorV2
     */
    function withdrawPmx(uint256 amount) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        _require(undistributedPMX >= amount, Errors.AMOUNT_EXCEEDS_AVAILABLE_BALANCE.selector);
        undistributedPMX -= amount;
        IERC20(pmx).transfer(treasury, amount);
        emit PmxWithdrawn(amount);
    }

    /**
     * @inheritdoc ISpotTradingRewardDistributorV2
     */
    function getPeriodInfo(uint256 _timestamp) external view override returns (uint256, uint256) {
        uint256 periodNumber = _getCurrentPeriod(_timestamp);
        uint256 currentPeriodNumber = _getCurrentPeriod(block.timestamp);
        PeriodInfo storage periodInfo = periods[periodNumber];
        uint256 totalReward;

        if (periodInfo.totalReward == 0 && currentPeriodNumber == periodNumber) {
            totalReward = rewardPerPeriod;
        } else {
            totalReward = periodInfo.totalReward;
        }
        return (totalReward, periodInfo.totalActivity);
    }

    /**
     * @inheritdoc ISpotTradingRewardDistributorV2
     */
    function getSpotTraderActivity(uint256 periodNumber, address trader) external view override returns (uint256) {
        return periods[periodNumber].traderActivity[trader];
    }

    /**
     * @inheritdoc ISpotTradingRewardDistributorV2
     */
    function calculateReward(address trader) public view override returns (uint256 reward, uint256 currentPeriod) {
        currentPeriod = _getCurrentPeriod(block.timestamp);
        uint256[] memory periodNumbers = periodsWithTraderActivity[trader];
        if (periodNumbers.length == 0) return (0, currentPeriod);

        uint256 length = periodNumbers[periodNumbers.length - 1] == currentPeriod
            ? periodNumbers.length - 1
            : periodNumbers.length;
        for (uint256 i; i < length; i++) {
            PeriodInfo storage periodInfo = periods[periodNumbers[i]];
            reward += (periodInfo.totalReward * periodInfo.traderActivity[trader]) / periodInfo.totalActivity;
        }
        return (reward, currentPeriod);
    }

    /**
     * @inheritdoc ISpotTradingRewardDistributorV2
     */
    function getPeriodsWithTraderActivity(address trader) public view override returns (uint256[] memory) {
        return periodsWithTraderActivity[trader];
    }

    /**
     * @notice Interface checker
     * @param _interfaceId The interface id to check
     */
    function supportsInterface(bytes4 _interfaceId) public view override returns (bool) {
        return
            _interfaceId == type(ISpotTradingRewardDistributorV2).interfaceId || super.supportsInterface(_interfaceId);
    }

    function _getCurrentPeriod(uint256 currentTimestamp) internal view returns (uint256) {
        return (currentTimestamp - initialPeriodTimestamp) / periodDuration;
    }
}
