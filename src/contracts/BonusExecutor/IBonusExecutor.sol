// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IPMXBonusNFT} from "../PMXBonusNFT/IPMXBonusNFT.sol";
import {IPausable} from "../interfaces/IPausable.sol";

interface IBonusExecutor is IPausable {
    struct BonusCount {
        uint256 count;
        uint256 maxCount;
    }

    /**
     * @dev Creates the ActivatedBonus bonus entity in the bonuses mapping. Called by NFT only
     * @param _nftId Id of activated token
     * @param _tier The nft tier
     * @param _bucket The bucket for activation
     * @param _owner The owner of the nft token
     */
    function activateBonus(uint256 _nftId, uint256 _tier, address _bucket, address _owner) external;

    /**
     * @dev Deactivates a bonus for a user in a specific bucket.
     * @param _user The address of the user.
     * @param _bucket The address of the bonus bucket.
     */
    function deactivateBonus(address _user, address _bucket) external;

    /**
     * @dev Claims tokens that users have accrued. Called by the user
     * @param _amount Amount of p-tokens to claim
     * @param _nftId Id of activated token
     **/
    function claim(uint256 _amount, uint256 _nftId) external;

    /**
     * @dev Sets the maximum bonus count for a specific bucket.
     * @param _bucket The address of the bucket.
     * @param _maxCount The maximum bonus count to be set.
     */
    function setMaxBonusCount(address _bucket, uint256 _maxCount) external;

    function nft() external view returns (IPMXBonusNFT);
}
