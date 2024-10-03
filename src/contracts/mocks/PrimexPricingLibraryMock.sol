// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {IPrimexPricingLibraryMock} from "../interfaces/IPrimexPricingLibraryMock.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";
import {IBucketV3} from "../Bucket/IBucket.sol";
import {IDexAdapter} from "../interfaces/IDexAdapter.sol";

import "../libraries/Errors.sol";

contract PrimexPricingLibraryMock is IPrimexPricingLibraryMock {
    using WadRayMath for uint256;

    function getDepositAmountInBorrowed(
        IDexAdapter.AmountParams calldata _params,
        bool _isThirdAsset,
        address payable _dexAdapter,
        address _priceOracle,
        bytes calldata _oracleData
    ) public override returns (uint256) {
        return
            PrimexPricingLibrary.getDepositAmountInBorrowed(
                _params,
                _isThirdAsset,
                _dexAdapter,
                _priceOracle,
                _oracleData
            );
    }

    function megaSwap(
        PrimexPricingLibrary.MegaSwapParams calldata _params,
        uint256 _maximumOracleTolerableLimit,
        address payable _dexAdapter,
        address _priceOracle,
        bool _needOracleTolerableLimitCheck,
        bytes calldata _oracleData
    ) public override returns (uint256) {
        return
            PrimexPricingLibrary.megaSwap(
                _params,
                _maximumOracleTolerableLimit,
                _dexAdapter,
                _priceOracle,
                _needOracleTolerableLimitCheck,
                _oracleData
            );
    }

    function getOracleAmountsOut(
        address _tokenA,
        address _tokenB,
        uint256 _amountAssetA,
        address _priceOracle,
        bytes calldata _oracleData
    ) public override returns (uint256) {
        return PrimexPricingLibrary.getOracleAmountsOut(_tokenA, _tokenB, _amountAssetA, _priceOracle, _oracleData);
    }

    function getLiquidationPrice(
        address _bucket,
        address _positionAsset,
        uint256 _positionAmount,
        uint256 _positionDebt,
        address _primexDNS
    ) public view override returns (uint256) {
        return
            PrimexPricingLibrary.getLiquidationPrice(
                _bucket,
                _positionAsset,
                _positionAmount,
                _positionDebt,
                _primexDNS
            );
    }

    /**
     * @notice Calculates the liquidation price for a given order.
     * @dev liquidationPrice = (feeBuffer * limitPrice * (leverage - 1)) /
     * ((1 - securityBuffer) * (1 - oracleTolerableLimit) * (1 - priceDrop) * leverage)
     * @param _bucket The address of the bucket.
     * @param _positionAsset The address of the position asset.
     * @param _limitPrice The limit price for the order.
     * @param _leverage The leverage in WAD format for the order.
     * @return The liquidation price calculated.
     */
    function getLiquidationPriceByOrder(
        address _bucket,
        address _positionAsset,
        uint256 _limitPrice,
        uint256 _leverage
    ) public view override returns (uint256) {
        _require(_positionAsset != address(0), Errors.ADDRESS_NOT_SUPPORTED.selector);
        if (_leverage == WadRayMath.WAD) return 0;
        PrimexPricingLibrary.LiquidationPriceData memory data;
        data.bucket = IBucketV3(_bucket);

        (, bool tokenAllowed) = data.bucket.allowedAssets(_positionAsset);
        _require(tokenAllowed, Errors.TOKEN_NOT_SUPPORTED.selector);

        data.positionManager = data.bucket.positionManager();
        data.priceOracle = data.positionManager.priceOracle();
        data.borrowedAsset = data.bucket.borrowedAsset();

        uint256 numerator = (data.bucket.feeBuffer()).wmul(_leverage - WadRayMath.WAD);
        uint256 denominator = (WadRayMath.WAD - data.positionManager.securityBuffer())
            .wmul(
                WadRayMath.WAD -
                    data.positionManager.getOracleTolerableLimit(_positionAsset, address(data.borrowedAsset))
            )
            .wmul(WadRayMath.WAD - data.priceOracle.getPairPriceDrop(_positionAsset, address(data.borrowedAsset)))
            .wmul(_leverage);

        return numerator.wdiv(denominator).wmul(_limitPrice);
    }
}
