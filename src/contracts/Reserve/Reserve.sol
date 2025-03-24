// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";

import "../libraries/Errors.sol";

import {ReserveStorage} from "./ReserveStorage.sol";
import {BIG_TIMELOCK_ADMIN, MEDIUM_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN} from "../Constants.sol";
import {IReserve, IPausable} from "./IReserve.sol";
import {IBucketV3} from "../Bucket/IBucket.sol";
import {IPToken} from "../PToken/IPToken.sol";
import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";

contract Reserve is IReserve, ReserveStorage {
    using WadRayMath for uint256;

    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Throws if caller is not granted with _role
     * @param _role The role to be checked
     */
    modifier onlyRole(bytes32 _role) {
        _require(IAccessControl(registry).hasRole(_role, msg.sender), Errors.FORBIDDEN.selector);
        _;
    }

    /**
     * @inheritdoc IReserve
     */
    function initialize(IPrimexDNSV3 _dns, address _registry) external override initializer {
        _require(
            IERC165Upgradeable(address(_dns)).supportsInterface(type(IPrimexDNSV3).interfaceId) &&
                IERC165Upgradeable(_registry).supportsInterface(type(IAccessControl).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        registry = _registry;
        dns = _dns;
        __Pausable_init();
        __ERC165_init();
        __ReentrancyGuard_init();
    }

    /**
     * @inheritdoc IReserve
     */
    function payBonus(string memory _bucketName, address _to, uint256 _amount) external override {
        (address bucket, , , ) = dns.buckets(_bucketName);
        IPToken pToken = IBucketV3(bucket).pToken();
        _require(
            address(IBucketV3(bucket).debtToken().feeDecreaser()) == msg.sender ||
                address(pToken.interestIncreaser()) == msg.sender,
            Errors.CALLER_IS_NOT_EXECUTOR.selector
        );
        pToken.transfer(_to, _amount);
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
     * @inheritdoc IReserve
     */
    function setTransferRestrictions(
        address pToken,
        TransferRestrictions calldata newTransferRestrictions
    ) external override onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        _require(
            newTransferRestrictions.minPercentOfTotalSupplyToBeLeft <= WadRayMath.WAD,
            Errors.INCORRECT_TRANSFER_RESTRICTIONS.selector
        );
        transferRestrictions[pToken] = newTransferRestrictions;
        emit TransferRestrictionsChanged(pToken, newTransferRestrictions);
    }

    /**
     * @inheritdoc IReserve
     */
    function transferToTreasury(
        address bucket,
        uint256 amount
    ) public override whenNotPaused onlyRole(MEDIUM_TIMELOCK_ADMIN) {
        _require(IBucketV3(bucket).getLiquidityMiningParams().isBucketLaunched, Errors.BUCKET_IS_NOT_LAUNCHED.selector);
        IPToken pToken = IBucketV3(bucket).pToken();
        uint256 reserveBalance = pToken.balanceOf(address(this));

        TransferRestrictions storage restrictions = transferRestrictions[address(pToken)];

        _require(
            reserveBalance >= (restrictions.minAmountToBeLeft + amount) &&
                reserveBalance >= (pToken.totalSupply().wmul(restrictions.minPercentOfTotalSupplyToBeLeft) + amount),
            Errors.NOT_SUFFICIENT_RESERVE_BALANCE.selector
        );

        IBucketV3(bucket).withdraw(dns.treasury(), amount);

        emit TransferFromReserve(address(pToken), dns.treasury(), amount);
    }

    /**
     * @inheritdoc IReserve
     */
    function paybackPermanentLoss(IBucketV3 _bucket) public override whenNotPaused nonReentrant {
        (address bucket, , , ) = dns.buckets(_bucket.name());
        _require(bucket == address(_bucket), Errors.ADDRESS_NOT_PRIMEX_BUCKET.selector);
        uint256 permanentLoss = _bucket.permanentLoss();
        uint256 balance = _bucket.pToken().balanceOf(address(this));

        uint256 burnAmount = permanentLoss <= balance ? permanentLoss : balance;
        emit BurnAmountCalculated(burnAmount);

        _require(burnAmount > 0, Errors.BURN_AMOUNT_IS_ZERO.selector);
        _bucket.paybackPermanentLoss(burnAmount);
    }

    /**
     *  @notice Interface checker
     *  @param _interfaceID The interface id to check
     */
    function supportsInterface(bytes4 _interfaceID) public view override returns (bool) {
        return _interfaceID == type(IReserve).interfaceId || super.supportsInterface(_interfaceID);
    }
}
