// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
/** @notice This contract (originally IPriceFeed) was taken from (https://github.com/decentralizedlabs/uniswap-v3-price-feed)

*/

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IUniLikeOracle} from "../interfaces/IUniLikeOracle.sol";
import {IAlgebraFactory} from "@cryptoalgebra/solidity-interfaces/contracts/core/IAlgebraFactory.sol";

interface IAlgebraPriceFeed is IUniLikeOracle {
    function algebraV3Factory() external view returns (IAlgebraFactory algebraV3Factory);

    function pools(address token0, address token1) external view returns (address poolAddress);

    function getPool(address tokenA, address tokenB) external view returns (address pool);

    function getQuote(
        uint128 baseAmount,
        address baseToken,
        address quoteToken,
        uint32 secondsTwapInterval
    ) external returns (uint256 quoteAmount);

    function registry() external view returns (IAccessControl);

    function twapInterval() external view returns (uint32);
}
