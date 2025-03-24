// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {ITiersManager} from "../TiersManager/ITiersManager.sol";

interface IDepositManagerStorage {
    struct Deposit {
        uint256 depositId;
        address owner;
        address bucket;
        uint256 scaledAmount;
        uint256 entryLiquidityIndex;
        uint256 deadline;
    }

    struct DepositExtendedInfo {
        uint256 depositStart;
        uint256 rewardAmount;
        uint256 claimedReward;
        address rewardToken;
    }

    /**
     * @notice Retrieves the instance of PrimexRegistry contract.
     */
    function registry() external view returns (IAccessControl);

    /**
     * @notice Retrieves the instance of PrimexDNS contract.
     */
    function primexDNS() external view returns (IPrimexDNSV3);

    /**
     * @notice Retrieves the instance of PriceOracle contract.
     */
    function priceOracle() external view returns (IPriceOracleV2);

    /**
     * @notice Retrieves the instance of WhiteBlackList contract.
     */
    function whiteBlackList() external view returns (IWhiteBlackList);

    /**
     * @notice Retrieves the instance of WhiteBlackList contract.
     */
    function tierManager() external view returns (ITiersManager);

    /**
     * @notice Incremental counter for deposit ids
     */
    function depositIdCounter() external view returns (uint256);

    /**
     * @notice Returns the interestRate by bucket, rewardToken and duration.
     */
    function interestRates(address, address, uint256) external view returns (uint256);

    /**
     * @notice Returns the max total deposits by bucket
     */
    function maxTotalDeposits(address) external view returns (uint256);
}
