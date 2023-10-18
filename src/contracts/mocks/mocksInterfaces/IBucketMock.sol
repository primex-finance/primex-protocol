// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IBucketStorage} from "../../Bucket/IBucketStorage.sol";

interface IBucketMock {
    function setDebtToken(address _debtToken) external;

    function mintDebtToken(address _trader, uint256 _amount, uint256 _index) external;

    function burnDebtToken(address _trader, uint256 _amount, uint256 _index) external;

    function setVariableBorrowIndex(uint128 _variableBorrowIndex) external;

    function setPToken(address _pToken) external;

    function mintPToken(address _trader, uint256 _amount, uint256 _index) external;

    function burnPToken(address _trader, uint256 _amount, uint256 _index) external;

    function setLiquidityIndex(uint128 _liquidityIndex) external;

    function setNormalizedIncome(uint256 _normalizedIncome) external;

    function setWhiteBlackList(address _whiteBlackList) external;

    function setActive(bool _active) external returns (bool);

    function setDelisted(bool _delisted) external returns (bool);

    function setLiquidityMiningParams(IBucketStorage.LiquidityMiningParams memory _newLMparams) external;

    function setCanClaimReward(bool _isClaimable) external;
}
