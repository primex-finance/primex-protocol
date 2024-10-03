// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {ICurvePool} from "../../interfaces/routers/ICurvePool.sol";

interface ICurveBotLens {
    function removeAndSetLiquidity(ICurvePool _pool, uint256[3] memory _amounts) external;
}
