// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import "../libraries/Errors.sol";

import {FeeExecutor} from "./FeeExecutor.sol";
import {IPMXBonusNFT} from "../PMXBonusNFT/IPMXBonusNFT.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IBucketV3} from "../Bucket/IBucket.sol";
import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";

contract InterestIncreaser is FeeExecutor {
    /**
     * @dev Initializes the contract.
     * @param _nft The address of the IPMXBonusNFT contract.
     * @param _registry The address of the registry contract.
     * @param _primexDNS The address of the PrimexDNS contract.
     * @param _whiteBlackList The address of the WhiteBlackList contract.
     */
    function initialize(
        IPMXBonusNFT _nft,
        address _registry,
        address _primexDNS,
        IWhiteBlackList _whiteBlackList
    ) external override initializer {
        __FeeExecutor_init(_nft, _registry, _primexDNS, _whiteBlackList);
    }

    /**
     * @dev Creates the ActivatedBonus bonus entity in the bonuses mapping. Called by NFT only
     * @param _nftId Id of activated token
     * @param _tier The nft tier
     * @param _bucket The bucket for activation
     * @param _owner The owner of the nft token
     */
    function activateBonus(
        uint256 _nftId,
        uint256 _tier,
        address _bucket,
        address _owner
    ) external override onlyNFT whenNotPaused {
        _require(
            address(bonuses[_owner][_bucket].bucket) == address(0),
            Errors.BONUS_FOR_BUCKET_ALREADY_ACTIVATED.selector
        );
        uint256 index = IBucketV3(_bucket).getNormalizedIncome();
        _updateIndex(index, address(_bucket));
        _activateBonus(_tier, _bucket, _nftId, _owner, index);
    }

    /**
     * @dev Update the accumulatedAmount and the lastUpdatedIndex of the existing ActivatedBonus. Called directly by the user
     * @param _nftId Id of activated token
     */
    function updateBonus(uint256 _nftId) external override whenNotPaused notBlackListed {
        ActivatedBonus memory bonus = bonuses[msg.sender][(nft.getNft(_nftId)).bucket];
        _require(address(bonus.bucket) != address(0) && bonus.nftId == _nftId, Errors.BONUS_DOES_NOT_EXIST.selector);
        uint256 index = bonus.bucket.getNormalizedIncome();
        _updateIndex(index, address(bonus.bucket));
        _updateBonus(bonus, msg.sender, bonus.bucket.pToken().scaledBalanceOf(msg.sender), index);
    }

    /**
     * @dev Claim tokens that users have accrued. Called by the user
     * @param _amount Amount of p-tokens to claim
     * @param _nftId Id of activated token
     */
    function claim(uint256 _amount, uint256 _nftId) external override nonReentrant whenNotPaused notBlackListed {
        _require(_amount > 0, Errors.AMOUNT_IS_0.selector);
        ActivatedBonus memory bonus = bonuses[msg.sender][(nft.getNft(_nftId)).bucket];
        _require(address(bonus.bucket) != address(0) && bonus.nftId == _nftId, Errors.BONUS_DOES_NOT_EXIST.selector);
        uint256 index = bonus.bucket.getNormalizedIncome();
        _updateIndex(index, address(bonus.bucket));
        if (_canUpdateBonus(bonus)) {
            if (bonus.deadline < block.timestamp) {
                index = _searchApproxIndex(bonus.deadline, index, address(bonus.bucket));
                bonus.deadline = type(uint256).max; // a magic number
            }
            if (index > bonus.lastUpdatedIndex) {
                bonus.accumulatedAmount = _calculateAccumulatedAmount(
                    bonus,
                    index,
                    bonus.bucket.pToken().scaledBalanceOf(msg.sender)
                );
                bonus.lastUpdatedIndex = index;
            }
        }
        _claim(bonus, _amount);
    }

    /**
     * @dev Update the accumulatedAmount and the lastUpdatedIndex of the existing ActivatedBonus. Called by the P-Token
     * @param _user User for which the bonus will be updated. If user doesn't have the bonus for pussed
     * @param _oldScaledBalance Balance of the user before the operation at which the updateBonus function was called (e.g mint/transfer)
     * @param _bucket The Bucket to which the ActivatedBonus relates
     */
    function updateBonus(
        address _user,
        uint256 _oldScaledBalance,
        address _bucket,
        uint256 _currentIndex
    ) public override {
        if (paused()) return;
        if (address(bonuses[_user][_bucket].bucket) == address(0)) {
            address bucket = IPrimexDNSV3(primexDNS).getBucketAddress(IBucketV3(_bucket).name());
            _require(address(IBucketV3(bucket).pToken()) == msg.sender, Errors.CALLER_IS_NOT_P_TOKEN.selector);
            _updateIndex(_currentIndex, _bucket);
            return;
        }
        ActivatedBonus memory bonus = bonuses[_user][_bucket];
        _require(address(bonus.bucket.pToken()) == msg.sender, Errors.CALLER_IS_NOT_P_TOKEN.selector);
        _updateIndex(_currentIndex, _bucket);
        _updateBonus(bonus, _user, _oldScaledBalance, _currentIndex);
    }

    /**
     * @dev Returns accumulated amount of p-tokens at the moment
     * @param _user The user for which the accumatedAmount will return. if the bonus does not exist will return 0.
     * If the NFT does not exist will throw
     * @param _nftId Id of activated token
     */
    function getAccumulatedAmount(address _user, uint256 _nftId) public view override returns (uint256) {
        ActivatedBonus memory bonus = bonuses[_user][(nft.getNft(_nftId)).bucket];
        if (address(bonus.bucket) == address(0)) {
            return 0;
        }
        return
            _getAccumulatedAmount(
                bonus,
                bonus.bucket.getNormalizedIncome(),
                bonus.bucket.pToken().scaledBalanceOf(_user)
            );
    }
}
