// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import "../libraries/Errors.sol";

import "./PrimexNFTStorage.sol";
import {BIG_TIMELOCK_ADMIN, MEDIUM_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN, NFT_MINTER} from "../Constants.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IPrimexNFT} from "./IPrimexNFT.sol";
import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";

contract PrimexNFT is IPrimexNFT, PrimexNFTStorage {
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    uint256 internal immutable chainId;

    constructor() {
        _disableInitializers();
        chainId = block.chainid;
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
     * @dev Modifier that checks if the caller has specific roles
     * @param _role1 The first role identifier to check.
     * @param _role2 The first role identifier to check.
     */
    modifier onlyRoles(bytes32 _role1, bytes32 _role2) {
        _require(
            IAccessControl(registry).hasRole(_role1, msg.sender) ||
                IAccessControl(registry).hasRole(_role2, msg.sender),
            Errors.FORBIDDEN.selector
        );
        _;
    }

    /**
     * @inheritdoc IPrimexNFT
     */
    function initialize(
        address _registry,
        string memory _name,
        string memory _symbol,
        string memory _newBaseURI
    ) external override initializer {
        _require(
            IERC165Upgradeable(_registry).supportsInterface(type(IAccessControl).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        registry = IAccessControl(_registry);
        __ERC721_init(_name, _symbol);
        baseURI = _newBaseURI;
    }

    /**
     * @inheritdoc IPrimexNFT
     */
    function mint(bytes memory _sig, SafeMintParams memory _nftParams) external override {
        address signer = ECDSA.recover(ECDSA.toEthSignedMessageHash(abi.encode(_nftParams)), _sig);
        _require(IAccessControl(registry).hasRole(NFT_MINTER, signer), Errors.FORBIDDEN.selector);
        _mint(_nftParams);
    }

    /**
     * @inheritdoc IPrimexNFT
     */

    function mint(SafeMintParams calldata _nftParams) external override onlyRoles(NFT_MINTER, SMALL_TIMELOCK_ADMIN) {
        _mint(_nftParams);
    }

    /**
     * @inheritdoc IPrimexNFT
     */

    function mintBatch(
        SafeMintParams[] calldata _nftParams
    ) external override onlyRoles(NFT_MINTER, SMALL_TIMELOCK_ADMIN) {
        for (uint256 i; i < _nftParams.length; i++) {
            _mint(_nftParams[i]);
        }
    }

    /**
     * @inheritdoc IPrimexNFT
     */

    function batchSetDeadline(
        uint256[] calldata _ids,
        uint256[] calldata _deadlines
    ) external override onlyRoles(NFT_MINTER, SMALL_TIMELOCK_ADMIN) {
        _require(_ids.length == _deadlines.length, Errors.PARAMS_LENGTH_MISMATCH.selector);
        for (uint256 i; i < _ids.length; i++) {
            _require(_exists(_ids[i]), Errors.ID_DOES_NOT_EXIST.selector);
            idToDeadLine[_ids[i]] = _deadlines[i];
        }
    }

    /**
     * @inheritdoc IPrimexNFT
     */
    function setBaseURI(string calldata _newBaseURI) external override onlyRoles(NFT_MINTER, SMALL_TIMELOCK_ADMIN) {
        baseURI = _newBaseURI;
    }

    /**
     * @inheritdoc IPrimexNFT
     */

    function haveUsersActiveTokens(address[] calldata _users) external view override returns (bool[] memory) {
        bool[] memory arr = new bool[](_users.length);
        for (uint256 i; i < _users.length; i++) {
            arr[i] = hasUserActiveToken(_users[i]);
        }
        return arr;
    }

    /**
     * @inheritdoc IPrimexNFT
     */

    function hasUserActiveToken(address _user) public view override returns (bool) {
        uint256 id;
        for (uint256 i; i < balanceOf(_user); i++) {
            id = tokenOfOwnerByIndex(_user, i);
            if (block.timestamp < idToDeadLine[id]) return true;
        }
        return false;
    }

    /**
     * @notice Interface checker
     * @param _interfaceId The interface id to check
     */
    function supportsInterface(
        bytes4 _interfaceId
    ) public view virtual override(ERC721EnumerableUpgradeable, IERC165Upgradeable) returns (bool) {
        return _interfaceId == type(IPrimexNFT).interfaceId || super.supportsInterface(_interfaceId);
    }

    /**
     * @notice Mints an NFT with the provided parameters.
     * @param _nftParams The SafeMintParams struct containing the parameters for minting the NFT.
     */
    function _mint(SafeMintParams memory _nftParams) internal {
        _require(_nftParams.chainId == chainId, Errors.WRONG_NETWORK.selector);
        _require(_nftParams.deadline > 0, Errors.WRONG_DEADLINE.selector);
        _safeMint(_nftParams.recipient, _nftParams.id);
        idToDeadLine[_nftParams.id] = _nftParams.deadline;
    }

    /**
     * @notice Returns baseURI string
     * @return string The baseURI string.
     */
    function _baseURI() internal view override returns (string memory) {
        return baseURI;
    }
}
