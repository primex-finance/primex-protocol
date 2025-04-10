// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;
import {ITiersManager} from "../TiersManager/ITiersManager.sol";

interface IPrimexDNSStorage {
    enum Status {
        Inactive,
        Active,
        Deprecated
    }

    enum OrderType {
        MARKET_ORDER,
        LIMIT_ORDER,
        SWAP_MARKET_ORDER,
        SWAP_LIMIT_ORDER
    }

    struct BucketData {
        address bucketAddress;
        Status currentStatus;
        uint256 delistingDeadline;
        // The deadline is for the admin to call Bucket.withdrawAfterDelisting().
        uint256 adminDeadline;
    }
    struct DexData {
        address routerAddress;
        bool isActive;
    }

    struct AdapterData {
        string[] dexes;
        bool isAdded;
    }

    function registry() external view returns (address);

    function delistingDelay() external view returns (uint256);

    function adminWithdrawalDelay() external view returns (uint256);

    function buckets(string memory) external view returns (address, Status, uint256, uint256);

    function dexes(string memory) external view returns (address, bool);

    function cmTypeToAddress(uint256 cmType) external view returns (address);

    function dexAdapter() external view returns (address);

    function pmx() external view returns (address);

    function treasury() external view returns (address);

    function aavePool() external view returns (address);

    function feeRates(OrderType _orderType, address _token) external view returns (uint256);
}

interface IPrimexDNSStorageV2 is IPrimexDNSStorage {
    struct FeeRestrictions {
        uint256 minProtocolFee;
        uint256 maxProtocolFee;
    }

    function feeRestrictions(
        OrderType _orderType
    ) external view returns (uint256 minProtocolFee, uint256 maxProtocolFee);
}

interface IPrimexDNSStorageV3 is IPrimexDNSStorageV2 {
    enum FeeRateType {
        MarginPositionClosedByTrader,
        SpotPositionClosedByTrader,
        MarginPositionClosedByKeeper,
        SpotPositionClosedByKeeper,
        MarginLimitOrderExecuted,
        SpotLimitOrderExecuted,
        SwapLimitOrderExecuted,
        SwapMarketOrder
    }

    enum TradingOrderType {
        MarginMarketOrder,
        SpotMarketOrder,
        MarginLimitOrder,
        MarginLimitOrderDepositInThirdAsset,
        SpotLimitOrder,
        SwapLimitOrder
    }

    enum CallingMethod {
        OpenPositionByOrder,
        ClosePositionByCondition
    }
    struct MinFeeRestrictions {
        uint256 maxGasAmount;
        uint256 baseLength;
    }

    function protocolFeeRates(FeeRateType _feeRateType) external view returns (uint256);

    function averageGasPerAction(TradingOrderType _tradingOrderType) external view returns (uint256);

    function minFeeRestrictions(
        CallingMethod _callingMethod
    ) external view returns (uint256 maxGasAmount, uint256 baseLength);

    function maxProtocolFee() external view returns (uint256);

    function protocolFeeCoefficient() external view returns (uint256);

    function liquidationGasAmount() external view returns (uint256);

    function additionalGasSpent() external view returns (uint256);

    function pmxDiscountMultiplier() external view returns (uint256);

    function gasPriceBuffer() external view returns (uint256);

    function leverageTolerance() external view returns (uint256);
}

interface IPrimexDNSStorageV4 is IPrimexDNSStorageV3 {
    function protocolFeeRatesByTier(FeeRateType _feeRateType, uint256 _tier) external view returns (uint256);

    function tiersManager() external view returns (ITiersManager);
}
