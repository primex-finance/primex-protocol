// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import {TokenTransfersLibrary} from "./libraries/TokenTransfersLibrary.sol";
import "./libraries/Errors.sol";

import {BIG_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN} from "./Constants.sol";
import {IRedeemer} from "./interfaces/IRedeemer.sol";
import {IPausable} from "./interfaces/IPausable.sol";
import {IEPMXToken} from "./interfaces/IEPMXToken.sol";

contract Redeemer is IRedeemer, IPausable, Pausable, ReentrancyGuard {
    uint256 internal constant WAD = 10 ** 18;
    address public immutable registry;
    address public immutable earlyPmx;
    address public immutable pmx;
    uint256 public rate = WAD;

    /**
     * @dev Modifier that checks if the caller has a specific role.
     * @param _role The role identifier to check.
     */
    modifier onlyRole(bytes32 _role) {
        _require(IAccessControl(registry).hasRole(_role, msg.sender), Errors.FORBIDDEN.selector);
        _;
    }

    constructor(address _earlyPmx, address _pmx, address _registry) {
        _require(
            IERC165(_earlyPmx).supportsInterface(type(IEPMXToken).interfaceId) &&
                IERC165(_pmx).supportsInterface(type(IERC20).interfaceId) &&
                IERC165(_registry).supportsInterface(type(IAccessControl).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );

        registry = _registry;
        earlyPmx = _earlyPmx;
        pmx = _pmx;
    }

    /**
     * @inheritdoc IRedeemer
     */
    function changeRate(uint256 _rate) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        _require(_rate > 0, Errors.ZERO_EXCHANGE_RATE.selector);
        rate = _rate;
        emit RateChanged(_rate);
    }

    /**
     * @inheritdoc IRedeemer
     */
    function redeem() external override nonReentrant whenNotPaused {
        uint256 amount = IERC20(earlyPmx).balanceOf(msg.sender);
        TokenTransfersLibrary.doTransferIn(earlyPmx, msg.sender, amount);
        // i don't use the WadRayMath because it can round up
        TokenTransfersLibrary.doTransferOut(pmx, msg.sender, (amount * rate) / WAD);
        IEPMXToken(earlyPmx).burn(amount);
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
}
