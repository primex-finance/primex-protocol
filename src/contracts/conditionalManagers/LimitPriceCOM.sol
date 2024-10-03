// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {LimitOrderLibrary} from "../libraries/LimitOrderLibrary.sol";
import "./../libraries/Errors.sol";

import {IPositionManagerV2} from "../PositionManager/IPositionManager.sol";
import {IKeeperRewardDistributorV3} from "../KeeperRewardDistributor/IKeeperRewardDistributor.sol";
import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";
import {IDexAdapter} from "../interfaces/IDexAdapter.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";
import {ILimitPriceCOM, IPrimexDNSStorageV3} from "../interfaces/ILimitPriceCOM.sol";
import {IConditionalOpeningManager} from "../interfaces/IConditionalOpeningManager.sol";
import {ITakeProfitStopLossCCM} from "../interfaces/ITakeProfitStopLossCCM.sol";
import {BIG_TIMELOCK_ADMIN} from "../Constants.sol";

contract LimitPriceCOM is IConditionalOpeningManager, ILimitPriceCOM, IERC165, Initializable {
    using WadRayMath for uint256;

    uint256 private constant CM_TYPE = 1;
    address public immutable registry;

    address public primexDNS;
    address public priceOracle;
    address public pm;
    address public keeperRewardDistributor;

    constructor(address _registry) {
        _require(
            IERC165(_registry).supportsInterface(type(IAccessControl).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        registry = _registry;
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
     * @inheritdoc ILimitPriceCOM
     */
    function initialize(
        address _primexDNS,
        address _priceOracle,
        address _pm,
        address _keeperRewardDistributor
    ) external override initializer onlyRole(BIG_TIMELOCK_ADMIN) {
        _require(
            IERC165(_primexDNS).supportsInterface(type(IPrimexDNSV3).interfaceId) &&
                IERC165(_priceOracle).supportsInterface(type(IPriceOracleV2).interfaceId) &&
                IERC165(_pm).supportsInterface(type(IPositionManagerV2).interfaceId) &&
                IERC165(_keeperRewardDistributor).supportsInterface(type(IKeeperRewardDistributorV3).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        primexDNS = _primexDNS;
        priceOracle = _priceOracle;
        pm = _pm;
        keeperRewardDistributor = _keeperRewardDistributor;
    }

    /**
     * @inheritdoc IConditionalOpeningManager
     */
    function canBeFilledAfterSwap(
        LimitOrderLibrary.LimitOrder calldata,
        bytes calldata _params,
        bytes calldata,
        uint256 _exchangeRate
    ) external pure override returns (bool) {
        if (_params.length == 0) {
            return false;
        }
        CanBeFilledVars memory vars;
        vars.params = abi.decode(_params, (CanBeFilledParams));
        return _exchangeRate <= vars.params.limitPrice;
    }

    /**
     * @notice Interface checker
     * @param _interfaceId The interface id to check
     */
    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return
            _interfaceId == type(IConditionalOpeningManager).interfaceId ||
            _interfaceId == type(ILimitPriceCOM).interfaceId ||
            _interfaceId == type(IERC165).interfaceId;
    }

    /**
     * @inheritdoc ILimitPriceCOM
     */
    function getLimitPrice(bytes calldata _params) public pure override returns (uint256) {
        CanBeFilledParams memory params;
        if (_params.length > 0) {
            params = abi.decode(_params, (CanBeFilledParams));
        }
        return (params.limitPrice);
    }
}
