// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import "../libraries/Errors.sol";

import "./PMXBonusNFTStorage.sol";
import {BIG_TIMELOCK_ADMIN, MEDIUM_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN, NFT_MINTER} from "../Constants.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IPMXBonusNFT, IPausable} from "./IPMXBonusNFT.sol";
import {IBonusExecutor} from "../BonusExecutor/IBonusExecutor.sol";
import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";

contract PMXBonusNFT is IPMXBonusNFT, PMXBonusNFTStorage {
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Modifier that checks if given id exists
     * @param _id The NFT id to check.
     */
    modifier exist(uint256 _id) {
        _require(_exists(_id), Errors.ID_DOES_NOT_EXIST.selector);
        _;
    }

    /**
     * @dev Modifier that checks if the caller has a specific role.
     * @param _role The role identifier to check.
     */
    modifier onlyRole(bytes32 _role) {
        _require(IAccessControl(registry).hasRole(_role, msg.sender), Errors.FORBIDDEN.selector);
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
     * @inheritdoc IPMXBonusNFT
     */
    function initialize(
        IPrimexDNSV3 _primexDNS,
        address _registry,
        IWhiteBlackList _whiteBlackList
    ) external override initializer {
        _require(
            IERC165Upgradeable(address(_primexDNS)).supportsInterface(type(IPrimexDNSV3).interfaceId) &&
                IERC165Upgradeable(address(_whiteBlackList)).supportsInterface(type(IWhiteBlackList).interfaceId) &&
                IERC165Upgradeable(_registry).supportsInterface(type(IAccessControl).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        registry = _registry;
        primexDNS = _primexDNS;
        whiteBlackList = _whiteBlackList;
        chainId = block.chainid;
        __ERC721_init("PMXBonusNFT", "PMXBNFT");
        __Pausable_init();
    }

    /**
     * @inheritdoc IPMXBonusNFT
     */
    function blockNft(uint256 _id) external override onlyRole(SMALL_TIMELOCK_ADMIN) {
        if (_exists(_id)) {
            NftMetadata storage data = nftList[idToIndex[_id]];
            // if we are able to override executor for bonusTypeId it won't work correctly
            if (data.activatedBy != address(0))
                bonusExecutors[data.bonusTypeId].deactivateBonus(data.activatedBy, data.bucket);
        }
        isBlocked[_id] = true;
        emit BlockedNftWithId(_id);
    }

    /**
     * @inheritdoc IPMXBonusNFT
     */
    function unblockNft(uint256 _id) external override onlyRole(SMALL_TIMELOCK_ADMIN) {
        isBlocked[_id] = false;
        emit UnblockedNftWithId(_id);
    }

    /**
     * @inheritdoc IPMXBonusNFT
     */
    function mint(bytes memory _sig, SafeMintParams memory _nftParams) external override notBlackListed {
        _require(!isBlocked[_nftParams.id], Errors.TOKEN_IS_BLOCKED.selector);
        address signer = ECDSA.recover(ECDSA.toEthSignedMessageHash(abi.encode(_nftParams)), _sig);
        _require(IAccessControl(registry).hasRole(NFT_MINTER, signer), Errors.FORBIDDEN.selector);
        _mint(_nftParams);
    }

    /**
     * @inheritdoc IPMXBonusNFT
     */
    function mint(SafeMintParams memory _nftParams) external override {
        _require(!isBlocked[_nftParams.id], Errors.TOKEN_IS_BLOCKED.selector);
        _require(IAccessControl(registry).hasRole(NFT_MINTER, msg.sender), Errors.FORBIDDEN.selector);
        _mint(_nftParams);
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
     * @inheritdoc IPMXBonusNFT
     */
    function activate(
        uint256 _id,
        string memory _bucketName
    ) external override exist(_id) whenNotPaused notBlackListed {
        _require(!isBlocked[_id], Errors.TOKEN_IS_BLOCKED.selector);
        _require(ownerOf(_id) == msg.sender, Errors.CALLER_IS_NOT_OWNER.selector);
        NftMetadata storage data = nftList[idToIndex[_id]];
        _require(data.activatedBy == address(0), Errors.TOKEN_IS_ALREADY_ACTIVATED.selector);
        data.activatedBy = msg.sender;
        data.bucket = primexDNS.getBucketAddress(_bucketName);
        bonusExecutors[data.bonusTypeId].activateBonus(_id, data.tier, data.bucket, msg.sender);
    }

    /**
     * @inheritdoc IPMXBonusNFT
     */
    function setExecutor(
        uint256 _bonusTypeId,
        IBonusExecutor _executor
    ) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        _require(
            IERC165Upgradeable(address(_executor)).supportsInterface(type(IBonusExecutor).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        bonusExecutors[_bonusTypeId] = _executor;
        emit ExecutorChanged(address(_executor));
    }

    /**
     * @inheritdoc IPMXBonusNFT
     */
    function getNft(uint256 _id) external view override exist(_id) returns (NftMetadata memory) {
        NftMetadata memory metadata = nftList[idToIndex[_id]];
        metadata.uri = _getURI(metadata, _id);
        return metadata;
    }

    /**
     * @inheritdoc IPMXBonusNFT
     */
    function tokenURI(
        uint256 _id
    ) public view override(ERC721Upgradeable, IPMXBonusNFT) exist(_id) returns (string memory) {
        return _getURI(nftList[idToIndex[_id]], _id);
    }

    /**
     * @notice Interface checker
     * @param _interfaceId The interface id to check
     */
    function supportsInterface(
        bytes4 _interfaceId
    ) public view virtual override(ERC721EnumerableUpgradeable, IERC165Upgradeable) returns (bool) {
        return _interfaceId == type(IPMXBonusNFT).interfaceId || super.supportsInterface(_interfaceId);
    }

    /**
     * @notice Mints an NFT with the provided parameters.
     * @param _nftParams The SafeMintParams struct containing the parameters for minting the NFT.
     */
    function _mint(SafeMintParams memory _nftParams) internal {
        _require(_nftParams.chainId == chainId, Errors.WRONG_NETWORK.selector);
        _require(_nftParams.uris.length > 0, Errors.WRONG_URIS_LENGTH.selector);
        idToIndex[_nftParams.id] = nftList.length;
        nftList.push(
            NftMetadata({
                bucket: address(0),
                bonusTypeId: _nftParams.bonusTypeId,
                tier: _nftParams.tier,
                activatedBy: address(0),
                uri: ""
            })
        );
        _safeMint(_nftParams.recipient, _nftParams.id);
        idToURIs[_nftParams.id] = _nftParams.uris;
    }

    /**
     * @notice Retrieves the token URI based on it's activation state
     * @param _metadata  The NftMetadata struct.
     * @param _id  The ID of the NFT.
     * @return string  The URI string
     */
    function _getURI(NftMetadata memory _metadata, uint256 _id) internal view returns (string memory) {
        return (idToURIs[_id].length > 1 && _metadata.activatedBy != address(0)) ? idToURIs[_id][1] : idToURIs[_id][0];
    }

    /**
     * @notice Returns baseURI string
     * @return string The baseURI string.
     */
    function _baseURI() internal pure override returns (string memory) {
        return "primexURL/";
    }
}
