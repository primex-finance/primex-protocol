// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IBalancer} from "../../interfaces/IBalancer.sol";

interface IBalancerBotLens {
    struct PoolUpdateData {
        bytes32 poolId;
        uint256[] amounts;
    }

    function removeAndSetLiquidity(
        IBalancer _vault,
        PoolUpdateData[] calldata _pools,
        IERC20[] calldata _tokensToReturn
    ) external;
}
