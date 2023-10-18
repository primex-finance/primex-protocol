// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {BatchManager} from "../../BatchManager.sol";
import {IUpgradeInterface} from "./IUpgradeInterface.sol";
import {IPositionManager} from "../../PositionManager/IPositionManager.sol";
import {IPriceOracle} from "../../PriceOracle/IPriceOracle.sol";
import {IWhiteBlackList} from "../../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";

contract BatchManagerV2 is IUpgradeInterface, BatchManager {
    uint256 public value;

    constructor(
        IPositionManager _positionManager,
        IPriceOracle _priceOracle,
        IWhiteBlackList _whiteBlackList,
        address _registry
    ) BatchManager(_positionManager, _priceOracle, _whiteBlackList, _registry) {}

    function testUpgrade() external pure override returns (string memory) {
        return "BatchManagerV2";
    }

    function setValue(uint256 _value) external override {
        value = _value;
    }
}
