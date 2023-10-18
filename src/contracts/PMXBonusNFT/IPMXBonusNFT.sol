// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IERC721EnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/IERC721EnumerableUpgradeable.sol";

import {IBucket} from "../Bucket/IBucket.sol";
import {IBonusExecutor} from "../BonusExecutor/IBonusExecutor.sol";
import {IPMXBonusNFTStorage} from "./IPMXBonusNFTStorage.sol";
import {IPausable} from "../interfaces/IPausable.sol";
import {IPrimexDNS} from "../PrimexDNS/IPrimexDNS.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";

interface IPMXBonusNFT is IPMXBonusNFTStorage, IERC721EnumerableUpgradeable, IPausable {
    struct SafeMintParams {
        uint256 bonusTypeId;
        uint256 tier;
        uint256 chainId;
        uint256 id;
        address recipient;
        string[] uris;
    }

    event ExecutorChanged(address indexed executor);
    event BlockedNftWithId(uint256 indexed id);
    event UnblockedNftWithId(uint256 indexed id);

    /**
     * @notice Initializes the PMXBonusNFT contract.
     * @param _primexDNS The address of the PrimexDNS contract.
     * @param _registry The address of the Registry contract.
     * @param _whiteBlackList The address of the WhiteBlacklist contract.
     */
    function initialize(IPrimexDNS _primexDNS, address _registry, IWhiteBlackList _whiteBlackList) external;

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
     * @notice Activates an NFT with the specified ID
     * @dev Only callable by the owner of the NFT.
     * @param _id The ID of the NFT to activate.
     * @param _bucketName The name of the bucket to assign the NFT to.
     */
    function activate(uint256 _id, string memory _bucketName) external;

    /**
     * @notice Sets the executor for the specified bonus type.
     * @dev Only callable by the BIG_TIMELOCK_ADMIN role.
     * @param _bonusFor The ID of the bonus type.
     * @param _executor The address of the bonus executor contract.
     */
    function setExecutor(uint256 _bonusFor, IBonusExecutor _executor) external;

    /**
     * @notice Blocks the specified NFT.
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN role.
     * @param _id The ID of the NFT to block.
     */
    function blockNft(uint256 _id) external;

    /**
     * @notice Unblocks the specified NFT.
     * @dev Only callable by the SMALL_TIMELOCK_ADMIN role.
     * @param _id The ID of the NFT to unblock.
     */
    function unblockNft(uint256 _id) external;

    /**
     * @notice Retrieves the metadata of an NFT.
     * @param _id The ID of the NFT.
     * @return The NftMetadata struct representing the metadata of the NFT.
     */
    function getNft(uint256 _id) external view returns (NftMetadata memory);

    /**
     * @notice Retrieves the token URI of the specified NFT.
     * @param _id The ID of the NFT.
     * @return The URI string.
     */
    function tokenURI(uint256 _id) external view returns (string memory);
}
