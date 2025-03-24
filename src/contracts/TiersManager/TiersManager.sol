// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {IPrimexNFT} from "../PrimexNFT/IPrimexNFT.sol";

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {TiersManagerStorage} from "./TiersManagerStorage.sol";
import {ITiersManager} from "./ITiersManager.sol";
import {SMALL_TIMELOCK_ADMIN, BIG_TIMELOCK_ADMIN, TRADER_MAGIC_TIER, FARMING_MAGIC_TIER, LENDER_MAGIC_TIER} from "../Constants.sol";
import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../libraries/Errors.sol";

contract TiersManager is ITiersManager, TiersManagerStorage {
    using WadRayMath for uint256;

    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Throws if caller is not granted with _role
     * @param _role The role that is being checked for a function caller
     */
    modifier onlyRole(bytes32 _role) {
        _require(registry.hasRole(_role, msg.sender), Errors.FORBIDDEN.selector);
        _;
    }

    function initialize(
        address _pmx,
        address _registry,
        address _lendingNFT,
        address _tradingNFT,
        address _farmingNFT,
        uint256[] calldata _tiers,
        uint256[] calldata _thresholds
    ) external override initializer {
        _require(
            IERC165Upgradeable(_pmx).supportsInterface(type(IERC20).interfaceId) &&
                IERC165Upgradeable(_registry).supportsInterface(type(IAccessControl).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        if (_lendingNFT != address(0)) {
            _require(
                IERC165Upgradeable(_lendingNFT).supportsInterface(type(IPrimexNFT).interfaceId),
                Errors.ADDRESS_NOT_SUPPORTED.selector
            );
            lendingNFT = IPrimexNFT(_lendingNFT);
        }
        if (_tradingNFT != address(0)) {
            _require(
                IERC165Upgradeable(_tradingNFT).supportsInterface(type(IPrimexNFT).interfaceId),
                Errors.ADDRESS_NOT_SUPPORTED.selector
            );
            tradingNFT = IPrimexNFT(_tradingNFT);
        }
        if (_farmingNFT != address(0)) {
            _require(
                IERC165Upgradeable(_farmingNFT).supportsInterface(type(IPrimexNFT).interfaceId),
                Errors.ADDRESS_NOT_SUPPORTED.selector
            );
            farmingNFT = IPrimexNFT(_farmingNFT);
        }
        pmx = _pmx;
        registry = IAccessControl(_registry);
        if (_tiers.length > 0) {
            _addTiers(_tiers, _thresholds, false);
        }
        __ERC165_init();
    }

    function initializeAfterUpgrade(address payable _traderBalanceVault) external override {}

    /**
     * @inheritdoc ITiersManager
     */
    function setPMX(address _pmx) external override onlyRole(SMALL_TIMELOCK_ADMIN) {
        pmx = _pmx;
        emit IPrimexDNSV3.PMXchanged(_pmx);
    }

    function getTraderTiersForAddresses(
        address[] calldata _userAddresses
    ) external view override returns (uint256[] memory) {
        uint256[] memory userTiers = new uint256[](_userAddresses.length);
        uint256[] memory _tiers = tiers;
        bool[] memory userHasActiveTradingNft = tradingNFT.haveUsersActiveTokens(_userAddresses);
        bool[] memory userHasActiveFarmingNft = farmingNFT.haveUsersActiveTokens(_userAddresses);
        IERC20 _pmx = IERC20(pmx);
        for (uint256 i; i < _userAddresses.length; i++) {
            if (userHasActiveTradingNft[i]) {
                userTiers[i] = TRADER_MAGIC_TIER;
                continue;
            }
            if (userHasActiveFarmingNft[i]) {
                userTiers[i] = FARMING_MAGIC_TIER;
                continue;
            }
            userTiers[i] = _getTierByBalance(_tiers, _pmx.balanceOf(_userAddresses[i]));
        }
        return userTiers;
    }

    function getTraderTierForAddress(address _userAddress) external view override returns (uint256) {
        uint256 balance = IERC20(pmx).balanceOf(_userAddress);
        bool userHasActiveTradingNft = tradingNFT.hasUserActiveToken(_userAddress);
        bool userHasActiveFarmingNft = farmingNFT.hasUserActiveToken(_userAddress);
        if (userHasActiveTradingNft) return TRADER_MAGIC_TIER;
        if (userHasActiveFarmingNft) return FARMING_MAGIC_TIER;
        // return zero tier
        if (balance == 0 || tiers.length == 0) return 0;
        uint256 prevTier = 0;
        for (uint256 i; i < tiers.length; i++) {
            uint256 threshold = tiersThresholds[tiers[i]];
            if (balance < threshold) {
                return prevTier;
            }
            prevTier = tiers[i];
        }
        // if this is the last tier and balance >= tier's threshold
        return prevTier;
    }

    function getLenderTierForAddress(address _userAddress) external view override returns (uint256) {
        if (lendingNFT.hasUserActiveToken(_userAddress)) return LENDER_MAGIC_TIER;
        return 0;
    }

    function addTiers(
        uint256[] calldata _tiers,
        uint256[] calldata _thresholds,
        bool _clearTiers
    ) external override onlyRole(SMALL_TIMELOCK_ADMIN) {
        _addTiers(_tiers, _thresholds, _clearTiers);
    }

    function changeThresholdForTier(
        uint256[] calldata _indexes,
        uint256[] calldata _newThresholds
    ) external override onlyRole(SMALL_TIMELOCK_ADMIN) {
        _require(_indexes.length == _newThresholds.length, Errors.PARAMS_LENGTH_MISMATCH.selector);
        for (uint256 i; i < _indexes.length; i++) {
            tiersThresholds[tiers[_indexes[i]]] = _newThresholds[i];
        }
    }

    function getTiers() external view override returns (uint256[] memory) {
        return tiers;
    }

    /**
     * @notice Interface checker
     * @param interfaceId The interface id to check
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(ITiersManager).interfaceId || super.supportsInterface(interfaceId);
    }

    function _getTierByBalance(uint256[] memory _tiers, uint256 totalBalance) internal view returns (uint256 prevTier) {
        if (totalBalance == 0 || _tiers.length == 0) return prevTier;
        for (uint256 i; i < _tiers.length; i++) {
            uint256 threshold = tiersThresholds[_tiers[i]];
            if (totalBalance < threshold) return prevTier;
            prevTier = _tiers[i];
        }
    }

    function _addTiers(uint256[] calldata _tiers, uint256[] calldata _thresholds, bool _clearTiers) internal {
        if (_clearTiers) delete tiers;
        _require(_tiers.length == _thresholds.length, Errors.PARAMS_LENGTH_MISMATCH.selector);
        _checkTiers(_tiers);
        for (uint256 i; i < _tiers.length; i++) {
            tiers.push(_tiers[i]);
            tiersThresholds[_tiers[i]] = _thresholds[i];
        }
    }

    function _checkTiers(uint256[] calldata _tiers) internal view {
        // zero tier by default
        _require(_tiers[0] > 0, Errors.INCORRECT_TIER.selector);
        if (tiers.length > 0) {
            _require(tiers[tiers.length - 1] < _tiers[0], Errors.INCORRECT_TIERS_ORDER.selector);
        }
        if (_tiers.length > 1) {
            for (uint256 i = 1; i < _tiers.length; i++) {
                _require(_tiers[i - 1] < _tiers[i], Errors.INCORRECT_TIERS_ORDER.selector);
            }
        }
    }
}
