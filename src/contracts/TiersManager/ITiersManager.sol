// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

interface ITiersManager {
    function initialize(
        address _pmx,
        address _registry,
        address _lendingNFT,
        address _tradingNFT,
        address _farmingNFT,
        uint256[] calldata _tiers,
        uint256[] calldata _thresholds
    ) external;

    function initializeAfterUpgrade(address payable _traderBalanceVault) external;

    function getTraderTierForAddress(address _userAddress) external view returns (uint256);

    function getLenderTierForAddress(address _userAddress) external view returns (uint256);

    function addTiers(uint256[] calldata _tiers, uint256[] calldata _thresholds, bool _clearTiers) external;

    function changeThresholdForTier(uint256[] calldata _indexes, uint256[] calldata _newThresholds) external;

    function getTiers() external view returns (uint256[] memory);

    function setPMX(address _pmx) external;

    function getTraderTiersForAddresses(address[] memory _userAddresses) external view returns (uint256[] memory);
}
