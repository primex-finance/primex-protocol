// (c) 2023 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {AggregatorV2V3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV2V3Interface.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

import {IPrimexAggregatorV3TestService} from "./interfaces/IPrimexAggregatorV3TestService.sol";

contract PrimexAggregatorV3TestService is IPrimexAggregatorV3TestService, AggregatorV2V3Interface, AccessControl {
    uint80 internal constant MAX_UINT80_HEX = 0xFFFFFFFFFFFFFFFFFFFF;
    bytes32 public constant DEFAULT_UPDATER_ROLE = keccak256("DEFAULT_UPDATER_ROLE");

    struct RoundData {
        uint80 roundId;
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
    }

    uint8 private _decimals;
    string private _name;
    uint80 private _currentRound;
    mapping(uint80 => RoundData) private _answers;
    RoundData public latestRounddata;

    constructor(string memory name, address updater) {
        _name = name;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        // DEFAULT_UPDATER_ROLE for msg.sender to facilitate initial setup and dev/stage work
        _grantRole(DEFAULT_UPDATER_ROLE, msg.sender);
        _grantRole(DEFAULT_UPDATER_ROLE, updater);
    }

    function latestAnswer() external view override returns (int256) {
        return latestRounddata.answer;
    }

    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        return (
            latestRounddata.roundId,
            latestRounddata.answer,
            latestRounddata.startedAt,
            latestRounddata.updatedAt,
            latestRounddata.answeredInRound
        );
    }

    function latestTimestamp() external view override returns (uint256) {
        return latestRounddata.updatedAt;
    }

    function getAnswer(uint256 roundId) external view override returns (int256) {
        if (roundId > MAX_UINT80_HEX) {
            return 0;
        }
        return _answers[uint80(roundId)].answer;
    }

    function getTimestamp(uint256 roundId) external view override returns (uint256) {
        if (roundId > MAX_UINT80_HEX) {
            return 0;
        }
        return _answers[uint80(roundId)].updatedAt;
    }

    function latestRound() external view override returns (uint256) {
        return latestRounddata.roundId;
    }

    function setAnswer(int256 answer) public override onlyRole(DEFAULT_UPDATER_ROLE) {
        latestRounddata.answer = answer;
        latestRounddata.roundId = _currentRound;
        latestRounddata.startedAt = block.timestamp;
        latestRounddata.updatedAt = block.timestamp;
        latestRounddata.answeredInRound = _currentRound;
        _answers[_currentRound] = latestRounddata;
        _currentRound++;
        emit AnswerUpdated(answer, latestRounddata.roundId, block.timestamp);
    }

    function setDecimals(uint256 newDecimals) public override onlyRole(DEFAULT_UPDATER_ROLE) {
        _decimals = uint8(newDecimals);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function getRoundData(uint80 _roundId) public view override returns (uint80, int256, uint256, uint256, uint80) {
        RoundData memory roundData = _answers[_roundId];
        return (
            roundData.roundId,
            roundData.answer,
            roundData.startedAt,
            roundData.updatedAt,
            roundData.answeredInRound
        );
    }

    function description() public pure override returns (string memory) {}

    function version() public pure override returns (uint256) {}
}
