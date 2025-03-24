// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {WadRayMath} from "../libraries/utils/WadRayMath.sol";
import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {TokenTransfersLibrary} from "../libraries/TokenTransfersLibrary.sol";
import "../libraries/Errors.sol";

import {IDepositManager, IPausable} from "./IDepositManager.sol";
import {DepositManagerStorage, DepositManagerStorageV3, IERC165Upgradeable, IAccessControl} from "./DepositManagerStorage.sol";
import {IPrimexDNSV3, IPrimexDNSStorageV3} from "../PrimexDNS/IPrimexDNS.sol";
import {IBucketV3} from "../Bucket/IBucket.sol";
import {IPToken} from "../PToken/IPToken.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IPrimexDNSStorage} from "../PrimexDNS/IPrimexDNSStorage.sol";
// solhint-disable-next-line max-line-length
import {SMALL_TIMELOCK_ADMIN, BIG_TIMELOCK_ADMIN, EMERGENCY_ADMIN, SECONDS_PER_YEAR, LENDER_MAGIC_TIER, MEDIUM_TIMELOCK_ADMIN} from "../Constants.sol";
import {ITiersManager} from "../TiersManager/ITiersManager.sol";

contract DepositManager is IDepositManager, DepositManagerStorageV3 {
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

    /**
     * @dev Modifier to check if the sender is not blacklisted.
     */
    modifier notBlackListed() {
        _require(!whiteBlackList.isBlackListed(msg.sender), Errors.SENDER_IS_BLACKLISTED.selector);
        _;
    }

    /**
     * @inheritdoc IDepositManager
     */
    function initialize(
        address _registry,
        address _primexDNS,
        address _priceOracle,
        address _whiteBlackList
    ) external override initializer {
        _require(
            IERC165Upgradeable(_registry).supportsInterface(type(IAccessControl).interfaceId) &&
                IERC165Upgradeable(_primexDNS).supportsInterface(type(IPrimexDNSV3).interfaceId) &&
                IERC165Upgradeable(_priceOracle).supportsInterface(type(IPriceOracleV2).interfaceId) &&
                IERC165Upgradeable(_whiteBlackList).supportsInterface(type(IWhiteBlackList).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        registry = IAccessControl(_registry);
        primexDNS = IPrimexDNSV3(_primexDNS);
        priceOracle = IPriceOracleV2(_priceOracle);
        whiteBlackList = IWhiteBlackList(_whiteBlackList);
        __ReentrancyGuard_init();
        __ERC165_init();
    }

    /**
     * @inheritdoc IDepositManager
     */

    function setTiersManager(address _tierManager) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        _require(
            IERC165Upgradeable(_tierManager).supportsInterface(type(ITiersManager).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        tierManager = ITiersManager(_tierManager);
    }

    /**
     * @inheritdoc IDepositManager
     */

    function setMagicTierCoefficient(uint256 _magicTierCoefficient) external override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        magicTierCoefficient = _magicTierCoefficient;
    }

    /**
     * @inheritdoc IDepositManager
     */
    function deposit(
        DepositParams calldata _params
    ) external payable override nonReentrant notBlackListed whenNotPaused {
        IBucketV3 bucket = IBucketV3(_params.bucket);
        (address bucketAddress, IPrimexDNSStorage.Status status, , ) = primexDNS.buckets(bucket.name());
        _require(_params.bucket == bucketAddress, Errors.BUCKET_OUTSIDE_PRIMEX_PROTOCOL.selector);
        _require(status == IPrimexDNSStorage.Status.Active, Errors.BUCKET_IS_NOT_ACTIVE.selector);
        _require(_params.depositReceiver != address(0), Errors.ADDRESS_NOT_SUPPORTED.selector);

        uint256 rewardPercent = interestRates[_params.bucket][_params.rewardToken][_params.duration];
        if (tierManager.getLenderTierForAddress(msg.sender) == LENDER_MAGIC_TIER) {
            rewardPercent = rewardPercent.wmul(magicTierCoefficient);
        }
        _require(rewardPercent > 0, Errors.REWARD_PERCENT_SHOULD_BE_GREATER_THAN_ZERO.selector);

        IPToken pToken = bucket.pToken();
        _require(
            maxTotalDeposits[_params.bucket] > pToken.balanceOf(address(this)) + _params.amount,
            Errors.DEPOSIT_EXCEEDS_MAX_TOTAL_DEPOSIT.selector
        );

        // token transfers
        IERC20 borrowedAsset = bucket.borrowedAsset();
        if (_params.isPToken) {
            TokenTransfersLibrary.doTransferIn(address(pToken), msg.sender, _params.amount);
        } else {
            TokenTransfersLibrary.doTransferIn(address(borrowedAsset), msg.sender, _params.amount);
            borrowedAsset.approve(_params.bucket, _params.amount);
            bucket.deposit(address(this), _params.amount);
        }

        // Get oracle data for reward calculation
        priceOracle.updatePullOracle{value: msg.value}(_params.pullOracleData, _params.pullOracleTypes);

        uint256 depositAmountInRewardAmount = PrimexPricingLibrary.getOracleAmountsOut(
            address(borrowedAsset),
            _params.rewardToken,
            _params.amount,
            address(priceOracle),
            _params.borrowedRewardAssetOracleData
        );

        uint256 rewardAmount = (depositAmountInRewardAmount.wmul(rewardPercent) * _params.duration) / SECONDS_PER_YEAR;
        _require(
            rewardAmount <= getWithdrawableAmount(_params.rewardToken),
            Errors.INSUFFICIENT_REWARD_TOKEN_BALANCE.selector
        );

        totalRewardAmount[_params.rewardToken] += rewardAmount;
        // create deposit
        uint256 liquidityIndex = bucket.liquidityIndex();
        uint256 scaledAmount = _params.amount.rdiv(liquidityIndex);

        Deposit memory newDeposit = Deposit({
            depositId: depositIdCounter,
            owner: _params.depositReceiver,
            bucket: _params.bucket,
            scaledAmount: scaledAmount,
            entryLiquidityIndex: liquidityIndex,
            deadline: block.timestamp + _params.duration
        });

        depositExtInfo[depositIdCounter] = DepositExtendedInfo({
            depositStart: block.timestamp,
            rewardAmount: rewardAmount,
            claimedReward: 0,
            rewardToken: _params.rewardToken
        });

        deposits.push(newDeposit);
        idToIndex[newDeposit.depositId] = deposits.length - 1;

        userDepositIds[newDeposit.owner].push(newDeposit.depositId);
        userDepositIndexes[newDeposit.depositId] = userDepositIds[newDeposit.owner].length - 1;

        bucketDepositIds[newDeposit.bucket].push(newDeposit.depositId);
        bucketDepositIndexes[newDeposit.depositId] = bucketDepositIds[newDeposit.bucket].length - 1;
        depositIdCounter++;

        emit FixedTermDepositCreated(
            _params.depositReceiver,
            _params.bucket,
            newDeposit.depositId,
            _params.amount,
            _params.duration
        );
    }

    /**
     * @inheritdoc IDepositManager
     */
    function unlock(
        uint256[] calldata _depositIds,
        address[] calldata _receivers,
        bool[] calldata _shouldWithdraw
    ) external override {
        _require(
            _depositIds.length == _receivers.length && _depositIds.length == _shouldWithdraw.length,
            Errors.PARAMS_LENGTH_MISMATCH.selector
        );
        for (uint256 i; i < _depositIds.length; i++) {
            Deposit memory unlockedDeposit = deposits[idToIndex[_depositIds[i]]];
            DepositExtendedInfo memory depositInfo = depositExtInfo[_depositIds[i]];
            _require(unlockedDeposit.deadline < block.timestamp, Errors.LOCK_TIME_IS_NOT_EXPIRED.selector);
            _require(unlockedDeposit.owner == msg.sender, Errors.CALLER_IS_NOT_OWNER.selector);
            // pay vested rewards, if any
            uint256 vestedRewardAmount = _computeClaimableAmount(unlockedDeposit, depositInfo);
            if (vestedRewardAmount > 0) {
                _payRewardTokens(_depositIds[i], vestedRewardAmount, depositInfo.rewardToken, _receivers[i]);
            }
            IBucketV3 bucket = IBucketV3(unlockedDeposit.bucket);
            uint256 unlockedAmount = unlockedDeposit.scaledAmount.rmul(bucket.liquidityIndex());

            if (_shouldWithdraw[i]) {
                bucket.withdraw(_receivers[i], unlockedAmount);
            } else {
                bucket.pToken().transfer(_receivers[i], unlockedAmount);
            }
            emit DepositUnlocked(_depositIds[i], _receivers[i], unlockedAmount, _shouldWithdraw[i]);
            _deleteDeposit(_depositIds[i], unlockedDeposit.bucket, unlockedDeposit.owner);
        }
    }

    /**
     * @inheritdoc IDepositManager
     */

    function claimRewardTokens(
        uint256[] calldata _depositIds,
        address[] calldata _receivers
    ) external override nonReentrant {
        _require(_depositIds.length == _receivers.length, Errors.PARAMS_LENGTH_MISMATCH.selector);
        for (uint256 i; i < _depositIds.length; i++) {
            Deposit memory deposit = deposits[idToIndex[_depositIds[i]]];
            DepositExtendedInfo memory depositInfo = depositExtInfo[_depositIds[i]];
            _require(deposit.owner == msg.sender, Errors.CALLER_IS_NOT_OWNER.selector);
            uint256 vestedRewardAmount = _computeClaimableAmount(deposit, depositInfo);
            _require(vestedRewardAmount > 0, Errors.VESTED_AMOUNT_IS_ZERO.selector);
            _payRewardTokens(_depositIds[i], vestedRewardAmount, depositInfo.rewardToken, _receivers[i]);
        }
    }

    /**
     * @inheritdoc IDepositManager
     */

    function computeClaimableAmount(uint256 _depositId) external view override returns (uint256) {
        _onlyExist(_depositId);
        Deposit memory _deposit = deposits[idToIndex[_depositId]];
        DepositExtendedInfo memory _depositInfo = depositExtInfo[_depositId];
        return _computeClaimableAmount(_deposit, _depositInfo);
    }

    /**
     * @inheritdoc IDepositManager
     */

    function withdrawUnclaimedReward(
        address[] calldata tokens,
        uint256[] calldata amounts,
        address recipient
    ) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        _require(tokens.length == amounts.length, Errors.PARAMS_LENGTH_MISMATCH.selector);
        for (uint256 i; i < tokens.length; i++) {
            _require(!isPToken[tokens[i]], Errors.TOKEN_CANNOT_BE_P_TOKEN.selector);
            _require(amounts[i] <= getWithdrawableAmount(tokens[i]), Errors.INSUFFICIENT_REWARD_TOKEN_BALANCE.selector);
            TokenTransfersLibrary.doTransferOut(tokens[i], recipient, amounts[i]);
        }
    }

    /**
     * @inheritdoc IDepositManager
     */
    function setRewardParameters(RewardParameters[] calldata params) external override onlyRole(SMALL_TIMELOCK_ADMIN) {
        for (uint256 i; i < params.length; i++) {
            address bucket = params[i].bucket;
            address[] calldata rewardTokens = params[i].rewardTokens;
            uint256[][] calldata durations = params[i].durations;
            uint256[][] calldata newInterestRates = params[i].newInterestRates;
            uint256 maxTotalDeposit = params[i].maxTotalDeposit;

            _require(
                rewardTokens.length == durations.length && rewardTokens.length == newInterestRates.length,
                Errors.PARAMS_LENGTH_MISMATCH.selector
            );

            for (uint256 j; j < rewardTokens.length; j++) {
                address rewardToken = rewardTokens[j];
                uint256[] calldata tokenDurations = durations[j];
                uint256[] calldata interestRatesForToken = newInterestRates[j];

                _require(tokenDurations.length == interestRatesForToken.length, Errors.PARAMS_LENGTH_MISMATCH.selector);

                if (!isRewardTokenInBucket[bucket][rewardToken]) {
                    isRewardTokenInBucket[bucket][rewardToken] = true;
                    bucketRewardTokens[bucket].push(rewardToken);
                    emit RewardTokenAdded(bucket, rewardToken);
                }

                for (uint256 k = 0; k < tokenDurations.length; k++) {
                    uint256 duration = tokenDurations[k];
                    uint256 interestRate = interestRatesForToken[k];

                    if (!isPossibleDurationInBucket[bucket][rewardToken][duration]) {
                        isPossibleDurationInBucket[bucket][rewardToken][duration] = true;
                        bucketPossibleDurations[bucket][rewardToken].push(duration);
                    }

                    interestRates[bucket][rewardToken][duration] = interestRate;
                    emit InterestRateSet(bucket, rewardToken, duration, interestRate);
                }
            }
            maxTotalDeposits[bucket] = maxTotalDeposit;
            isPToken[address(IBucketV3(bucket).pToken())] = true;
            emit MaxTotalDepositSet(bucket, maxTotalDeposit);
        }
    }

    // Getter functions //

    /**
     * @inheritdoc IDepositManager
     */

    function getWithdrawableAmount(address _rewardToken) public view override returns (uint256 amount) {
        uint256 balance = IERC20(_rewardToken).balanceOf(address(this));
        if (balance > totalRewardAmount[_rewardToken] - totalClaimedReward[_rewardToken]) {
            return balance + totalClaimedReward[_rewardToken] - totalRewardAmount[_rewardToken];
        }
    }

    /**
     * @inheritdoc IDepositManager
     */

    function getDepositInfoById(uint256 _depositId) external view override returns (DepositInfo memory) {
        _onlyExist(_depositId);
        Deposit memory _deposit = deposits[idToIndex[_depositId]];
        DepositExtendedInfo memory _depositInfo = depositExtInfo[_depositId];
        return
            DepositInfo(
                _deposit.depositId,
                _deposit.owner,
                _deposit.bucket,
                _deposit.scaledAmount,
                _deposit.entryLiquidityIndex,
                _deposit.deadline,
                _depositInfo.depositStart,
                _depositInfo.rewardAmount,
                _depositInfo.claimedReward,
                _depositInfo.rewardToken
            );
    }

    /**
     * @inheritdoc IDepositManager
     */
    function getDeposits(
        uint256 _cursor,
        uint256 _count
    ) external view override returns (Deposit[] memory depositsData, uint256 newCursor) {
        uint256 depositsLength = deposits.length;
        if (_cursor >= depositsLength) {
            return (new Deposit[](0), 0);
        }
        if (_cursor + _count >= depositsLength) {
            _count = depositsLength - _cursor;
        } else {
            newCursor = _cursor + _count;
        }

        depositsData = new Deposit[](_count);
        for (uint256 i; i < _count; i++) {
            depositsData[i] = deposits[_cursor + i];
        }
        return (depositsData, newCursor);
    }

    function getDepositById(uint256 _depositId) external view override returns (Deposit memory) {
        _onlyExist(_depositId);
        return deposits[idToIndex[_depositId]];
    }

    /**
     * @inheritdoc IDepositManager
     */
    function getAllDepositsLength() external view override returns (uint256) {
        return deposits.length;
    }

    /**
     * @inheritdoc IDepositManager
     */
    function getBucketPosibleDurations(
        address _bucket,
        address _rewardToken
    ) external view override returns (uint256[] memory) {
        return bucketPossibleDurations[_bucket][_rewardToken];
    }

    /**
     * @inheritdoc IDepositManager
     */
    function getBucketRewardTokens(address _bucket) external view override returns (address[] memory) {
        return bucketRewardTokens[_bucket];
    }

    /**
     * @inheritdoc IDepositManager
     */
    function getDepositsByUser(
        address _user,
        uint256 _cursor,
        uint256 _count
    ) external view override returns (DepositInfo[] memory userDepositsData, uint256 newCursor) {
        uint256[] storage depositIds = userDepositIds[_user];
        uint256 numDeposits = depositIds.length;
        if (_cursor >= numDeposits) {
            return (new DepositInfo[](0), 0);
        }
        if (_cursor + _count >= numDeposits) {
            _count = numDeposits - _cursor;
        } else {
            newCursor = _cursor + _count;
        }
        userDepositsData = new DepositInfo[](_count);

        for (uint256 i; i < _count; i++) {
            Deposit memory _deposit = deposits[idToIndex[depositIds[_cursor + i]]];
            DepositExtendedInfo memory _depositInfo = depositExtInfo[depositIds[_cursor + i]];
            userDepositsData[i] = DepositInfo(
                _deposit.depositId,
                _deposit.owner,
                _deposit.bucket,
                _deposit.scaledAmount,
                _deposit.entryLiquidityIndex,
                _deposit.deadline,
                _depositInfo.depositStart,
                _depositInfo.rewardAmount,
                _depositInfo.claimedReward,
                _depositInfo.rewardToken
            );
        }

        return (userDepositsData, newCursor);
    }

    /**
     * @inheritdoc IDepositManager
     */
    function getDepositsByBucket(
        address _bucket,
        uint256 _cursor,
        uint256 _count
    ) external view override returns (DepositInfo[] memory bucketDepositsData, uint256 newCursor) {
        uint256[] storage depositIds = bucketDepositIds[_bucket];
        uint256 numDeposits = depositIds.length;
        if (_cursor >= numDeposits) {
            return (new DepositInfo[](0), 0);
        }
        if (_cursor + _count >= numDeposits) {
            _count = numDeposits - _cursor;
        } else {
            newCursor = _cursor + _count;
        }
        bucketDepositsData = new DepositInfo[](_count);

        for (uint256 i = 0; i < _count; i++) {
            Deposit memory _deposit = deposits[idToIndex[depositIds[_cursor + i]]];
            DepositExtendedInfo memory _depositInfo = depositExtInfo[depositIds[_cursor + i]];
            bucketDepositsData[i] = DepositInfo(
                _deposit.depositId,
                _deposit.owner,
                _deposit.bucket,
                _deposit.scaledAmount,
                _deposit.entryLiquidityIndex,
                _deposit.deadline,
                _depositInfo.depositStart,
                _depositInfo.rewardAmount,
                _depositInfo.claimedReward,
                _depositInfo.rewardToken
            );
        }
        return (bucketDepositsData, newCursor);
    }

    /**
     * @inheritdoc IDepositManager
     */
    function getUserDepositIds(address _user) external view override returns (uint256[] memory) {
        return userDepositIds[_user];
    }

    /**
     * @inheritdoc IDepositManager
     */
    function getBucketDepositIds(address _bucket) external view override returns (uint256[] memory) {
        return bucketDepositIds[_bucket];
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
     * @notice Interface checker
     * @param _interfaceId The interface id to check
     */
    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return _interfaceId == type(IDepositManager).interfaceId || super.supportsInterface(_interfaceId);
    }

    /**
     * @dev delete deposit and update indexes (by trader, by bucket)
     * @param _depositId the id of the position to be deleted
     * @param _bucket the bucket of the deposit to be deleted
     * @param _user the user of the deposit to be deleted
     */
    function _deleteDeposit(uint256 _depositId, address _bucket, address _user) internal {
        uint256 lastBucketDepositId = bucketDepositIds[_bucket][bucketDepositIds[_bucket].length - 1];
        bucketDepositIds[_bucket][bucketDepositIndexes[_depositId]] = lastBucketDepositId;
        bucketDepositIndexes[lastBucketDepositId] = bucketDepositIndexes[_depositId];
        bucketDepositIds[_bucket].pop();
        delete bucketDepositIndexes[_depositId];

        uint256 lastUserDepositId = userDepositIds[_user][userDepositIds[_user].length - 1];
        userDepositIds[_user][userDepositIndexes[_depositId]] = lastUserDepositId;
        userDepositIndexes[lastUserDepositId] = userDepositIndexes[_depositId];
        userDepositIds[_user].pop();
        delete userDepositIndexes[_depositId];

        deposits[idToIndex[_depositId]] = deposits[deposits.length - 1];
        idToIndex[deposits[deposits.length - 1].depositId] = idToIndex[_depositId];
        deposits.pop();
        delete idToIndex[_depositId];
        //clear extend info
        delete depositExtInfo[_depositId];
    }

    function _computeClaimableAmount(
        Deposit memory _deposit,
        DepositExtendedInfo memory _depositInfo
    ) internal view returns (uint256) {
        uint256 currentTime = block.timestamp;
        // if the deposit was created before the update
        if (_depositInfo.depositStart == 0 || _depositInfo.claimedReward == _depositInfo.rewardAmount) {
            return 0;
        }
        // If the current time is after the deposit deadline, all tokens are releasable,
        // minus the amount already claimed.
        else if (currentTime >= _deposit.deadline) {
            return _depositInfo.rewardAmount - _depositInfo.claimedReward;
        }
        // Otherwise, some tokens are claimable.
        else {
            // Compute the number of full vesting periods that have elapsed.
            uint256 duration = _deposit.deadline - _depositInfo.depositStart;
            uint256 timeFromStart = currentTime - _depositInfo.depositStart;

            // Compute the amount of tokens that are claimed.
            uint256 vestedAmount = (_depositInfo.rewardAmount * timeFromStart) / duration;
            // Subtract the amount already released and return.
            return vestedAmount - _depositInfo.claimedReward;
        }
    }

    function _payRewardTokens(uint256 _depositId, uint256 _amount, address _token, address _receiver) internal {
        depositExtInfo[_depositId].claimedReward += _amount;
        totalClaimedReward[_token] += _amount;
        TokenTransfersLibrary.doTransferOut(_token, _receiver, _amount);
        emit RewardPaid(_depositId, _receiver, _token, _amount);
    }

    /**
     * @dev function to check if a position exists.
     * @param _depositId The ID of the deposit to check.
     */
    function _onlyExist(uint256 _depositId) internal view {
        _require(
            deposits.length > 0 && _depositId == deposits[idToIndex[_depositId]].depositId,
            Errors.DEPOSIT_DOES_NOT_EXIST.selector
        );
    }
}
