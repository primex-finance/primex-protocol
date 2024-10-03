// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IPositionManagerV2} from "../PositionManager/IPositionManager.sol";
import {IPrimexDNSStorageV3} from "../PrimexDNS/PrimexDNS.sol";

interface IPrimexLensPart2 {
    /**
     * @notice Calculate min protocol fee during liquidation,
     * @param _pm The instance of the PositionManager contract.
     */
    function getEstimatedMinProtocolFeeLiquidation(IPositionManagerV2 _pm) external view returns (uint256);
}
