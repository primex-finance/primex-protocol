// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";

import "../libraries/Errors.sol";

import "./FeeExecutorStorage.sol";
import {BonusExecutor, IBonusExecutor, BIG_TIMELOCK_ADMIN} from "./BonusExecutor.sol";
import {HOUR} from "../Constants.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IPMXBonusNFT} from "../PMXBonusNFT/IPMXBonusNFT.sol";
import {IReserve} from "../Reserve/IReserve.sol";
import {IBucketV3} from "../Bucket/IBucket.sol";
import {IDebtToken} from "../DebtToken/IDebtToken.sol";
import {IFeeExecutor} from "./IFeeExecutor.sol";

abstract contract FeeExecutor is IFeeExecutor, BonusExecutor, FeeExecutorStorage {
    using WadRayMath for uint256;

    //In case the child contracts get their own storage (e.g FeeExecutor) and we can't update storage of this contract.
    //You don't need to move this in the FeeExecutorStorage{version} contracts.
    uint256[50] private __gap;

    function initialize(
        IPMXBonusNFT _nft,
        address _registry,
        address _primexDNS,
        IWhiteBlackList _whiteBlackList
    ) external virtual;

    /**
     * @inheritdoc IFeeExecutor
     */
    function setTierBonus(
        address _bucket,
        uint256[] calldata _tiers,
        NFTBonusParams[] calldata _bonuses
    ) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        _require(_tiers.length == _bonuses.length, Errors.WRONG_LENGTH.selector);

        for (uint256 i; i < _tiers.length; i++) {
            _require(_bonuses[i].percent != 0, Errors.BONUS_PERCENT_IS_ZERO.selector);
            tierBonus[_bucket][_tiers[i]] = _bonuses[i];
        }
    }

    /**
     * @inheritdoc IBonusExecutor
     */
    function deactivateBonus(address _user, address _bucket) external override onlyNFT {
        delete bonuses[_user][_bucket];
    }

    /**
     * @inheritdoc IFeeExecutor
     */
    function updateBonuses(
        address[] memory _users,
        uint256[] memory _oldBalances,
        address _bucket,
        uint256 _currentIndex
    ) external override {
        for (uint256 i; i < _users.length; i++) {
            updateBonus(_users[i], _oldBalances[i], _bucket, _currentIndex);
        }
    }

    /**
     * @inheritdoc IFeeExecutor
     */
    function getBonus(address _user, uint256 _nftId) external view override returns (ActivatedBonus memory) {
        ActivatedBonus memory bonus = bonuses[_user][(nft.getNft(_nftId)).bucket];
        bonus.accumulatedAmount = getAccumulatedAmount(_user, _nftId);
        return bonus;
    }

    /**
     * @inheritdoc IFeeExecutor
     */
    function getAvailableAmount(address _user, uint256 _nftId) external view override returns (uint256) {
        ActivatedBonus storage bonus = bonuses[_user][(nft.getNft(_nftId)).bucket];
        return getAccumulatedAmount(_user, _nftId) - bonus.claimedAmount;
    }

    /**
     * @inheritdoc IFeeExecutor
     */
    function updateBonus(
        address _user,
        uint256 _oldScaledBalance,
        address _bucket,
        uint256 _currentIndex
    ) public virtual;

    /**
     * @inheritdoc IFeeExecutor
     */
    function getAccumulatedAmount(address _user, uint256 _nftId) public view virtual returns (uint256);

    /// @notice Interface checker
    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return super.supportsInterface(_interfaceId) || _interfaceId == type(IFeeExecutor).interfaceId;
    }

    /**
     * @dev Initializes the FeeExecutor contract.
     * @param _nft The address of the IPMXBonusNFT contract.
     * @param _registry The address of the registry contract.
     * @param _primexDNS The address of the PrimexDNS contract.
     * @param _whiteBlackList The address of the WhiteBlackList contract.
     */
    // solhint-disable-next-line func-name-mixedcase
    function __FeeExecutor_init(
        IPMXBonusNFT _nft,
        address _registry,
        address _primexDNS,
        IWhiteBlackList _whiteBlackList
    ) internal onlyInitializing {
        primexDNS = _primexDNS;
        __BonusExecutor_init(_nft, _registry, _whiteBlackList);
    }

    /**
     * @dev Internal function to activate a bonus for a user.
     * @param _tier The tier of the bonus.
     * @param _bucket The address of the bucket.
     * @param _nftId The ID of the NFT.
     * @param _user The address of the user.
     */
    function _activateBonus(uint256 _tier, address _bucket, uint256 _nftId, address _user, uint256 _index) internal {
        BonusCount storage bonusCount = bucketBonusCount[_bucket];
        _require(bonusCount.count < bonusCount.maxCount, Errors.MAX_BONUS_COUNT_EXCEEDED.selector);
        NFTBonusParams storage bonus = tierBonus[_bucket][_tier];
        _require(bonus.percent != 0, Errors.TIER_IS_NOT_ACTIVE.selector);
        bonuses[_user][_bucket] = ActivatedBonus({
            nftId: _nftId,
            bucket: IBucketV3(_bucket),
            percent: bonus.percent,
            maxAmount: bonus.maxAmount,
            accumulatedAmount: 0,
            lastUpdatedIndex: _index,
            deadline: bonus.duration > 0 ? block.timestamp + bonus.duration : 0,
            claimedAmount: 0
        });
        bonusCount.count++;
    }

    /**
     * @dev Internal function to update the bonus for a user.
     * @param _bonus The activated bonus for the user.
     * @param _user The user's address.
     * @param _scaledBalance The scaled balance of the user.
     * @param _currentIndex The current index of the bonus update.
     */
    function _updateBonus(
        ActivatedBonus memory _bonus,
        address _user,
        uint256 _scaledBalance,
        uint256 _currentIndex
    ) internal {
        if (_canUpdateBonus(_bonus)) {
            ActivatedBonus storage bonus = bonuses[_user][address(_bonus.bucket)];

            if (_bonus.deadline < block.timestamp) {
                _currentIndex = _searchApproxIndex(_bonus.deadline, _currentIndex, address(_bonus.bucket));
                bonus.deadline = type(uint256).max; // a magic number
                // it can happen when the index grew unevenly in this case we do not update the accumulatedAmount
                if (_currentIndex <= _bonus.lastUpdatedIndex) return;
            }
            bonus.accumulatedAmount = _calculateAccumulatedAmount(_bonus, _currentIndex, _scaledBalance);
            bonus.lastUpdatedIndex = _currentIndex;
        }
    }

    /**
     * @dev Updates the index with the given timestamp.
     * @param _index The index to be updated.
     * @param _bucket The bucket address for which index is being updated.
     */
    function _updateIndex(uint256 _index, address _bucket) internal {
        if (
            updatedTimestamps[_bucket].length == 0 ||
            updatedTimestamps[_bucket][updatedTimestamps[_bucket].length - 1] + HOUR <= block.timestamp
        ) {
            updatedTimestamps[_bucket].push(block.timestamp);
            indexes[_bucket][block.timestamp] = _index;
        }
    }

    /**
     * @dev Internal function to claim a bonus for a given ActivatedBonus and amount.
     * @param _bonus The ActivatedBonus struct containing bonus information.
     * @param _amount The amount to claim.
     */
    function _claim(ActivatedBonus memory _bonus, uint256 _amount) internal {
        if (_bonus.accumulatedAmount > _bonus.claimedAmount) {
            uint256 transferAmount = _bonus.claimedAmount + _amount > _bonus.accumulatedAmount
                ? _bonus.accumulatedAmount - _bonus.claimedAmount
                : _amount;
            _bonus.claimedAmount += transferAmount;
            _bonus.bucket.reserve().payBonus(_bonus.bucket.name(), msg.sender, transferAmount);
        }
        if ((!_canUpdateBonus(_bonus) && _bonus.claimedAmount == _bonus.accumulatedAmount)) {
            delete bonuses[msg.sender][address(_bonus.bucket)];
            bucketBonusCount[address(_bonus.bucket)].count--;
        } else {
            bonuses[msg.sender][address(_bonus.bucket)] = _bonus;
        }
    }

    /**
     * @dev Retrieves the accumulated amount for a given bonus.
     * @param _bonus The ActivatedBonus struct containing bonus information.
     * @param _currentIndex The current index.
     * @param _scaledBalance The scaled balance.
     * @return The accumulated amount.
     */
    function _getAccumulatedAmount(
        ActivatedBonus memory _bonus,
        uint256 _currentIndex,
        uint256 _scaledBalance
    ) internal view returns (uint256) {
        if (_bonus.deadline > 0) {
            if (_bonus.deadline == type(uint256).max) {
                return _bonus.accumulatedAmount;
            }
            if (_bonus.deadline < block.timestamp) {
                _currentIndex = _searchApproxIndex(_bonus.deadline, _currentIndex, address(_bonus.bucket));
                // it can happen when the index grew unevenly in this case we do not update the accumulatedAmount
                if (_currentIndex <= _bonus.lastUpdatedIndex) return _bonus.accumulatedAmount;
            }
        }
        return _calculateAccumulatedAmount(_bonus, _currentIndex, _scaledBalance);
    }

    /**
     * @dev Returns the approximate index for a given bonus deadline and current index.
     * @param _bonusDeadline The bonus deadline to search for.
     * @param _currentIndex The current index to compare with.
     * @param _bucket The bucket address for which an index is being searched.
     * @return The approximate index.
     */
    function _searchApproxIndex(
        uint256 _bonusDeadline,
        uint256 _currentIndex,
        address _bucket
    ) internal view returns (uint256) {
        // at this moment the length of the updatedTimestamps array mast be > 0 and the first element is less than the _bonusDeadline
        uint256 lowest;
        uint256 highest = updatedTimestamps[_bucket].length - 1;
        uint256 highestTimestamp = updatedTimestamps[_bucket][highest];
        // _bonus.deadline < block.timestamp)
        if (_bonusDeadline > highestTimestamp || lowest == highest) {
            return
                _calculateApproxIndex(
                    indexes[_bucket][highestTimestamp],
                    _currentIndex,
                    highestTimestamp,
                    block.timestamp,
                    _bonusDeadline
                );
        }
        //
        while (lowest < highest) {
            if (lowest == highest - 1) break;
            uint256 mid = (lowest + highest) / 2;
            uint256 midTimestamp = updatedTimestamps[_bucket][mid];
            if (_bonusDeadline < midTimestamp) {
                highest = mid;
            } else if (_bonusDeadline > midTimestamp) {
                lowest = mid;
            } else {
                return indexes[_bucket][midTimestamp];
            }
        }
        //if _bonusDeadline is between the lowest and highest timestamps we calculate the approx value that could be in that timestamp
        uint256 lowestTimestamp = updatedTimestamps[_bucket][lowest];
        highestTimestamp = updatedTimestamps[_bucket][highest];
        return
            _calculateApproxIndex(
                indexes[_bucket][lowestTimestamp],
                indexes[_bucket][highestTimestamp],
                lowestTimestamp,
                highestTimestamp,
                _bonusDeadline
            );
    }

    /**
     * @dev Calculates the accumulated amount for a bonus based on the provided parameters.
     * @param _bonus The activated bonus.
     * @param _currentIndex The current index.
     * @param _scaledBalance The scaled balance.
     * @return The calculated accumulated amount.
     */
    function _calculateAccumulatedAmount(
        ActivatedBonus memory _bonus,
        uint256 _currentIndex,
        uint256 _scaledBalance
    ) internal pure returns (uint256) {
        uint256 bonusIncrement = _bonus.percent.wmul(_scaledBalance).rmul(_currentIndex - _bonus.lastUpdatedIndex);
        if (_bonus.maxAmount > 0) {
            return
                (_bonus.accumulatedAmount + bonusIncrement >= _bonus.maxAmount)
                    ? _bonus.maxAmount
                    : _bonus.accumulatedAmount + bonusIncrement;
        }
        return _bonus.accumulatedAmount + bonusIncrement;
    }

    /**
     * @dev Checks if a bonus can be updated.
     * @param _bonus The ActivatedBonus struct representing the bonus.
     * @return A boolean value indicating whether the bonus can be updated or not.
     */
    function _canUpdateBonus(ActivatedBonus memory _bonus) internal pure returns (bool) {
        if (_bonus.maxAmount > 0) {
            if (_bonus.accumulatedAmount >= _bonus.maxAmount) return false;
        }
        if (_bonus.deadline > 0) {
            if (_bonus.deadline == type(uint256).max) return false;
        }
        return true;
    }

    /**
     * @dev Calculates the approximate index based on given parameters.
     * @param _lowestIndex The lowest index value.
     * @param _highestIndex The highest index value.
     * @param _lowestTimestamp The lowest timestamp value.
     * @param _highestTimestamp The highest timestamp value.
     * @param _bonusDeadline The bonus deadline timestamp.
     * @return The calculated approximate index.
     */
    function _calculateApproxIndex(
        uint256 _lowestIndex,
        uint256 _highestIndex,
        uint256 _lowestTimestamp,
        uint256 _highestTimestamp,
        uint256 _bonusDeadline
    ) internal pure returns (uint256) {
        // lowestIndex + (highestIndex - lowestIndex) * ((bonusDeadline - lowestTimestamp) / (highestTimestamp - lowestTimestamp))
        return
            _lowestIndex +
            (_highestIndex - _lowestIndex).rmul(
                ((_bonusDeadline - _lowestTimestamp).rdiv(_highestTimestamp - _lowestTimestamp))
            );
    }
}
