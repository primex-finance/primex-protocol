// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";

import {TokenTransfersLibrary} from "../libraries/TokenTransfersLibrary.sol";
import {FlashLoanManagerStorage, IERC165Upgradeable} from "./FlashLoanManagerStorage.sol";
import {BIG_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN, FLASH_LOAN_FREE_BORROWER_ROLE} from "../Constants.sol";
import "../libraries/Errors.sol";

import {IFlashLoanReceiver} from "../interfaces/IFlashLoanReceiver.sol";
import {IFlashLoanManager, IPausable} from "./IFlashLoanManager.sol";
import {IBucketV4} from "../Bucket/IBucket.sol";
import {IPrimexDNS} from "../PrimexDNS/IPrimexDNS.sol";
import {IPrimexDNSStorage} from "../PrimexDNS/IPrimexDNSStorage.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";

contract FlashLoanManager is IFlashLoanManager, FlashLoanManagerStorage {
    using WadRayMath for uint256;

    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Throws if caller is not granted with _role
     * @param _role The role that is being checked for a function caller
     */
    modifier onlyRole(bytes32 _role) {
        _require(registry.hasRole(_role, msg.sender), Errors.FORBIDDEN.selector);
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
     * @inheritdoc IFlashLoanManager
     */
    function initialize(
        address _registry,
        address _primexDNS,
        address _whiteBlackList,
        uint256 _flashLoanFeeRate,
        uint256 _flashLoanProtocolRate
    ) external override initializer {
        _require(
            IERC165Upgradeable(_registry).supportsInterface(type(IAccessControl).interfaceId) &&
                IERC165Upgradeable(_primexDNS).supportsInterface(type(IPrimexDNS).interfaceId) &&
                IERC165Upgradeable(_whiteBlackList).supportsInterface(type(IWhiteBlackList).interfaceId),
            Errors.ADDRESS_NOT_SUPPORTED.selector
        );
        whiteBlackList = IWhiteBlackList(_whiteBlackList);
        registry = IAccessControl(_registry);
        primexDNS = IPrimexDNS(_primexDNS);
        _setFlashLoanRates(_flashLoanFeeRate, _flashLoanProtocolRate);
    }

    /**
     * @inheritdoc IFlashLoanManager
     */
    function setFlashLoanRates(
        uint256 _newFlashLoanFeeRate,
        uint256 _newFlashLoanProtocolRate
    ) external override onlyRole(BIG_TIMELOCK_ADMIN) {
        _setFlashLoanRates(_newFlashLoanFeeRate, _newFlashLoanProtocolRate);
    }

    /**
     * @inheritdoc IFlashLoanManager
     */
    function flashLoan(
        address receiver,
        address[] calldata buckets,
        uint256[] calldata amounts,
        bytes calldata params
    ) external override nonReentrant notBlackListed whenNotPaused {
        _require(buckets.length == amounts.length, Errors.INCONSISTENT_FLASHLOAN_PARAMS.selector);
        _hasNoBucketsDuplicates(buckets);
        bool isZeroFee = registry.hasRole(FLASH_LOAN_FREE_BORROWER_ROLE, msg.sender);
        address[] memory assets = new address[](buckets.length);
        uint256[] memory flashLoanFees = new uint256[](buckets.length);
        uint256[] memory availableLiquidities = new uint256[](buckets.length);

        for (uint256 i; i < buckets.length; i++) {
            IBucketV4 bucket = IBucketV4(buckets[i]);
            (address bucketAddress, IPrimexDNSStorage.Status status, , ) = primexDNS.buckets(bucket.name());
            _require(buckets[i] == bucketAddress, Errors.BUCKET_OUTSIDE_PRIMEX_PROTOCOL.selector);
            _require(status == IPrimexDNSStorage.Status.Active, Errors.BUCKET_IS_NOT_ACTIVE.selector);
            assets[i] = address(bucket.borrowedAsset());
            flashLoanFees[i] = isZeroFee ? 0 : amounts[i].wmul(flashLoanFeeRate);
            availableLiquidities[i] = bucket.availableLiquidity();
            bucket.performFlashLoanTransfer(receiver, amounts[i]);
        }

        _require(
            IFlashLoanReceiver(receiver).executeOperation(assets, amounts, flashLoanFees, msg.sender, params),
            Errors.INVALID_FLASHLOAN_EXECUTOR_RETURN.selector
        );

        for (uint256 i; i < buckets.length; i++) {
            _handleFlashLoanRepayment(
                IBucketV4(buckets[i]),
                assets[i],
                amounts[i],
                flashLoanFees[i],
                availableLiquidities[i],
                receiver
            );
        }
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
     * @notice Interface checker
     * @param _interfaceId The interface id to check
     */
    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return _interfaceId == type(IFlashLoanManager).interfaceId || super.supportsInterface(_interfaceId);
    }

    /**
     * @notice Handles repayment of flashloaned assets + flashLoanFee
     * @dev Will pull the amount + flashLoanFee from the receiver to the Bucket and Treasury
     */
    function _handleFlashLoanRepayment(
        IBucketV4 bucket,
        address asset,
        uint256 amount,
        uint256 flashLoanFee,
        uint256 availableLiquidity,
        address receiver
    ) internal {
        uint256 feeToTreasury = flashLoanFee.wmul(flashLoanProtocolRate);
        uint256 feeToBucket = flashLoanFee - feeToTreasury;
        uint256 amountPlusFeeToBucket = amount + feeToBucket;
        // Accumulates a predefined amount of asset to the bucket as a fixed, instantaneous income
        bucket.cumulateToLiquidityIndex(feeToBucket, availableLiquidity);

        // The receiver should approve the flash loaned amount + fee for the FlashLoanManager.
        TokenTransfersLibrary.doTransferFromTo(asset, receiver, address(bucket), amountPlusFeeToBucket);
        TokenTransfersLibrary.doTransferFromTo(asset, receiver, primexDNS.treasury(), feeToTreasury);

        bucket.updateRates();
        emit FlashLoan(receiver, msg.sender, asset, amount, flashLoanFee, feeToTreasury);
    }

    function _setFlashLoanRates(uint256 _newFlashLoanFeeRate, uint256 _newFlashLoanProtocolRate) internal {
        _require(_newFlashLoanFeeRate <= WadRayMath.WAD / 10, Errors.FLASH_LOAN_FEE_RATE_IS_MORE_10_PERCENT.selector);
        _require(
            _newFlashLoanProtocolRate <= WadRayMath.WAD / 2,
            Errors.FLASH_LOAN_PROTOCOL_RATE_IS_MORE_50_PERCENT.selector
        );
        flashLoanFeeRate = _newFlashLoanFeeRate;
        flashLoanProtocolRate = _newFlashLoanProtocolRate;
        emit ChangedFlashLoanRates(_newFlashLoanFeeRate, _newFlashLoanProtocolRate);
    }

    /**
     * @notice Checks if an array of has no duplicate addresses.
     * @param _addresses The array of buckets addresses to be checked. The array should be sorted in ascending order before being passed.
     */
    function _hasNoBucketsDuplicates(address[] calldata _addresses) internal pure {
        if (_addresses.length > 1) {
            for (uint256 i = 1; i < _addresses.length; i++) {
                _require(_addresses[i - 1] < _addresses[i], Errors.SHOULD_NOT_HAVE_DUPLICATES.selector);
            }
        }
    }
}
