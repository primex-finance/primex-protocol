// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import "./../libraries/Errors.sol";

import {IBucketV4} from "./Bucket.sol";
import {BIG_TIMELOCK_ADMIN, MEDIUM_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN} from "../Constants.sol";
import {IBucketsFactory} from "./IBucketsFactory.sol";
import {IPrimexDNS} from "../PrimexDNS/IPrimexDNS.sol";
import {IBucket} from "../Bucket/IBucket.sol";
import {IPToken} from "../PToken/IPToken.sol";
import {IReserve} from "../Reserve/IReserve.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {IDebtToken} from "../DebtToken/IDebtToken.sol";
import {IPositionManager} from "../PositionManager/IPositionManager.sol";
import {IPriceOracle} from "../PriceOracle/IPriceOracle.sol";
import {IPTokensFactory} from "../PToken/IPTokensFactory.sol";
import {IDebtTokensFactory} from "../DebtToken/IDebtTokensFactory.sol";
import {IBucketStorage} from "./IBucketStorage.sol";

contract BucketsFactoryV2 is UpgradeableBeacon, IBucketsFactory, IERC165 {
    IPTokensFactory public pTokensFactory;
    IDebtTokensFactory public debtTokensFactory;
    address[] public override buckets;
    address public immutable override registry;

    /**
     * @dev Modifier that checks if the caller has a specific role.
     * @param _role The role identifier to check.
     */
    modifier onlyRole(bytes32 _role) {
        _require(IAccessControl(registry).hasRole(_role, msg.sender), Errors.FORBIDDEN.selector);
        _;
    }

    constructor(
        address _registry,
        IPTokensFactory _pTokensFactory,
        IDebtTokensFactory _debtTokensFactory,
        address _bucketImplementation
    ) UpgradeableBeacon(_bucketImplementation) {
        _require(
            IERC165(_registry).supportsInterface(type(IAccessControl).interfaceId) &&
                IERC165(address(_pTokensFactory)).supportsInterface(type(IPTokensFactory).interfaceId) &&
                IERC165(address(_debtTokensFactory)).supportsInterface(type(IDebtTokensFactory).interfaceId) &&
                IERC165(address(_bucketImplementation)).supportsInterface(type(IBucketV4).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        pTokensFactory = _pTokensFactory;
        debtTokensFactory = _debtTokensFactory;
        registry = _registry;
    }

    /**
     * @inheritdoc IBucketsFactory
     */
    function createBucket(CreateBucketParams memory _params) external override onlyRole(SMALL_TIMELOCK_ADMIN) {
        IPToken newPToken = pTokensFactory.createPToken(
            string(abi.encodePacked("Primex pToken ", _params.underlyingAsset.name())),
            string(abi.encodePacked("P-", _params.underlyingAsset.symbol())),
            _params.underlyingAsset.decimals()
        );

        IDebtToken newDebtToken = debtTokensFactory.createDebtToken(
            string(abi.encodePacked("Primex DebtToken ", _params.underlyingAsset.name())),
            string(abi.encodePacked("debt-", _params.underlyingAsset.symbol())),
            _params.underlyingAsset.decimals()
        );

        bytes memory initData = abi.encodeWithSelector(
            IBucket.initialize.selector,
            IBucket.ConstructorParams({
                name: _params.nameBucket,
                pToken: newPToken,
                debtToken: newDebtToken,
                positionManager: IPositionManager(_params.positionManager),
                priceOracle: IPriceOracle(_params.priceOracle),
                dns: IPrimexDNS(_params.dns),
                reserve: IReserve(_params.reserve),
                whiteBlackList: IWhiteBlackList(_params.whiteBlackList),
                assets: _params.assets,
                borrowedAsset: _params.underlyingAsset,
                feeBuffer: _params.feeBuffer,
                withdrawalFeeRate: _params.withdrawalFeeRate,
                reserveRate: _params.reserveRate,
                liquidityMiningRewardDistributor: _params.liquidityMiningRewardDistributor,
                liquidityMiningAmount: _params.liquidityMiningAmount,
                liquidityMiningDeadline: _params.liquidityMiningDeadline,
                stabilizationDuration: _params.stabilizationDuration,
                interestRateStrategy: _params.interestRateStrategy,
                maxAmountPerUser: _params.maxAmountPerUser,
                isReinvestToAaveEnabled: _params.isReinvestToAaveEnabled,
                estimatedBar: _params.estimatedBar,
                estimatedLar: _params.estimatedLar,
                barCalcParams: _params.barCalcParams,
                maxTotalDeposit: _params.maxTotalDeposit
            }),
            registry
        );
        address instance = address(new BeaconProxy(address(this), initData));

        newPToken.setBucket(IBucket(instance));
        newDebtToken.setBucket(IBucket(instance));

        buckets.push(instance);
        emit BucketCreated(instance);
    }

    /**
     * @inheritdoc IBucketsFactory
     */
    function setPTokensFactory(IPTokensFactory _pTokensFactory) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        _require(
            IERC165(address(_pTokensFactory)).supportsInterface(type(IPTokensFactory).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        pTokensFactory = _pTokensFactory;
        emit PTokensFactoryChanged(address(pTokensFactory));
    }

    /**
     * @inheritdoc IBucketsFactory
     */
    function setDebtTokensFactory(
        IDebtTokensFactory _debtTokensFactory
    ) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        _require(
            IERC165(address(_debtTokensFactory)).supportsInterface(type(IDebtTokensFactory).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        debtTokensFactory = _debtTokensFactory;
        emit DebtTokensFactoryChanged(address(debtTokensFactory));
    }

    /**
     * @inheritdoc IBucketsFactory
     */
    function allBuckets() external view override returns (address[] memory) {
        return buckets;
    }

    /**
     * @inheritdoc UpgradeableBeacon
     */

    function upgradeTo(address _bucketImplementation) public override {
        super.upgradeTo(_bucketImplementation);
    }

    /// @notice Interface checker
    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return _interfaceId == type(IBucketsFactory).interfaceId || _interfaceId == type(IERC165).interfaceId;
    }
}
