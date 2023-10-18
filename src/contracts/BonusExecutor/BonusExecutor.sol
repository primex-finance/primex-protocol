// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";

import "../libraries/Errors.sol";

import {BIG_TIMELOCK_ADMIN, MEDIUM_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN} from "../Constants.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IPMXBonusNFT} from "../PMXBonusNFT/IPMXBonusNFT.sol";
import {IReserve} from "../Reserve/IReserve.sol";
import {IBucket} from "../Bucket/IBucket.sol";
import {IDebtToken} from "../DebtToken/IDebtToken.sol";
import {IBonusExecutor, IPausable} from "./IBonusExecutor.sol";

abstract contract BonusExecutor is IBonusExecutor, ReentrancyGuardUpgradeable, PausableUpgradeable, ERC165Upgradeable {
    IPMXBonusNFT public override nft;
    address public registry;
    // Mapping from bucket to BonusCount
    mapping(address => BonusCount) public bucketBonusCount;
    IWhiteBlackList internal whiteBlackList;

    //to new variables without shifting down storage in the inheritance chain.
    uint256[50] private __gap;

    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Throws if called by any account other than the NFT.
     */
    modifier onlyNFT() {
        _require(address(nft) == msg.sender, Errors.CALLER_IS_NOT_NFT.selector);
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
     * @inheritdoc IBonusExecutor
     */
    function setMaxBonusCount(address _bucket, uint256 _maxCount) external override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        bucketBonusCount[_bucket].maxCount = _maxCount;
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

    /// @notice Interface checker
    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return super.supportsInterface(_interfaceId) || _interfaceId == type(IBonusExecutor).interfaceId;
    }

    /**
     * @dev Initializes the BonusExecutor contract.
     * @param _nft The address of the IPMXBonusNFT contract.
     * @param _registry The address of the registry contract.
     * @param _whiteBlackList The address of the WhiteBlackList contract.
     * @notice This function is internal and can only be called during initialization.
     */
    // solhint-disable-next-line func-name-mixedcase
    function __BonusExecutor_init(
        IPMXBonusNFT _nft,
        address _registry,
        IWhiteBlackList _whiteBlackList
    ) internal onlyInitializing {
        _require(
            IERC165Upgradeable(address(_nft)).supportsInterface(type(IPMXBonusNFT).interfaceId) &&
                IERC165Upgradeable(_registry).supportsInterface(type(IAccessControl).interfaceId) &&
                IERC165Upgradeable(address(_whiteBlackList)).supportsInterface(type(IWhiteBlackList).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        registry = _registry;
        nft = _nft;
        whiteBlackList = _whiteBlackList;
        __ReentrancyGuard_init();
        __Pausable_init();
        __ERC165_init();
    }
}
