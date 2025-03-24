// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IERC721EnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/IERC721EnumerableUpgradeable.sol";
import {IPrimexNFTStorage} from "./IPrimexNFTStorage.sol";
import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";

interface IPrimexNFT is IPrimexNFTStorage, IERC721EnumerableUpgradeable {
    struct SafeMintParams {
        uint256 chainId;
        uint256 id;
        address recipient;
        uint256 deadline;
    }

    /**
     * @notice Initializes the PrimexNFT contract.
     * @param _registry The address of the Registry contract.
     * @param _name The name of the NFT token
     * @param _symbol The name of the NFT token
     * @param _newBaseURI a new baseURI
     */
    function initialize(
        address _registry,
        string memory _name,
        string memory _symbol,
        string memory _newBaseURI
    ) external;

    /**
     * @notice Mints an NFT with the provided signature and parameters.
     * @dev The signature should be created by the user with NFT_MINTER role assigned.
     * @param _sig The signature used to validate the minter.
     * @param _nftParams The SafeMintParams struct containing the parameters for minting the NFT.
     */
    function mint(bytes memory _sig, SafeMintParams memory _nftParams) external;

    /**
     * @notice Mints an NFT with the provided parameters.
     * @dev Only callable by the NFT_MINTER role.
     * @param _nftParams The SafeMintParams struct containing the parameters for minting the NFT.
     */
    function mint(SafeMintParams memory _nftParams) external;

    /**
     * @notice Mints NFT batch with the provided parameters.
     * @dev Only callable by the NFT_MINTER role.
     * @param _nftParams The array of SafeMintParams struct containing the parameters for minting the NFT.
     */

    function mintBatch(SafeMintParams[] calldata _nftParams) external;

    /**
     * @notice Returns an array of flag whether the user has an active token
     * @param _users an array of users
     * @return an array of flags
     */
    function haveUsersActiveTokens(address[] calldata _users) external view returns (bool[] memory);

    /**
     * @notice Returns a flag whether the user has an active token
     * @param _user an address of the user
     */
    function hasUserActiveToken(address _user) external view returns (bool);

    /**
     * @notice Sets deadlines for a batch of ids
     * @dev Only callable by the NFT_MINTER role.
     * @param _ids an array of ids
     * @param _deadlines an array of_deadlines
     */

    function batchSetDeadline(uint256[] calldata _ids, uint256[] calldata _deadlines) external;

    /**
     * @notice Sets the new baseURI
     * @dev Only callable by the NFT_MINTER role.
     * @param _newBaseURI a new baseURI
     */
    function setBaseURI(string calldata _newBaseURI) external;
}
