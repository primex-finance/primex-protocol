// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {IDexAdapter} from "../interfaces/IDexAdapter.sol";

interface IPrimexPricingLibraryMock {
    function getOracleAmountsOut(
        address _tokenA,
        address _tokenB,
        uint256 _amountAssetA,
        address _priceOracle,
        bytes calldata _oracleData
    ) external returns (uint256);

    function getDepositAmountInBorrowed(
        IDexAdapter.AmountParams memory _params,
        bool _isThirdAsset,
        address payable _dexAdapter,
        address _priceOracle,
        bytes calldata _oracleData
    ) external returns (uint256);

    function megaSwap(
        PrimexPricingLibrary.MegaSwapParams calldata _params,
        uint256 _maximumOracleTolerableLimit,
        address payable _dexAdapter,
        address _priceOracle,
        bool _needOracleTolerableLimitCheck,
        bytes calldata _oracleData
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
