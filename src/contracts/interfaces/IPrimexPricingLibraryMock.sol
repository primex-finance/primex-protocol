// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";

interface IPrimexPricingLibraryMock {
    function getAmountOut(PrimexPricingLibrary.AmountParams memory _params) external returns (uint256);

    function getAmountIn(PrimexPricingLibrary.AmountParams memory _params) external returns (uint256);

    function getOracleAmountsOut(
        address _tokenA,
        address _tokenB,
        uint256 _amountAssetA,
        address _priceOracle
    ) external returns (uint256);

    function getDepositAmountInBorrowed(
        PrimexPricingLibrary.AmountParams memory _params,
        bool _isThirdAsset,
        address _priceOracle
    ) external returns (uint256);

    function multiSwap(
        PrimexPricingLibrary.MultiSwapParams memory _params,
        uint256 _oracleTolerableLimit,
        address _primexDNS,
        address _priceOracle,
        bool _needCheck
    ) external returns (uint256);

    function getLiquidationPrice(
        address _bucket,
        address _positionAsset,
        uint256 _positionAmount,
        uint256 _positionDebt
    ) external view returns (uint256);

    function getLiquidationPriceByOrder(
        address _bucket,
        address _positionAsset,
        uint256 _limitPrice,
        uint256 _leverage
    ) external view returns (uint256);
}
