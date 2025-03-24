// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import {IPausable} from "../interfaces/IPausable.sol";
import {IDepositManagerStorage} from "./IDepositManagerStorage.sol";

interface IDepositManager is IDepositManagerStorage, IPausable {
    event FixedTermDepositCreated(
        address indexed depositReceiver,
        address indexed bucket,
        uint256 indexed depositId,
        uint256 amount,
        uint256 duration
    );

    event RewardPaid(
        uint256 indexed depositId,
        address indexed rewardReceiver,
        address indexed rewardToken,
        uint256 rewardAmount
    );

    event DepositUnlocked(uint256 indexed depositId, address indexed receiver, uint256 amount, bool shouldWithdraw);

    event RewardTokenAdded(address indexed bucket, address indexed rewardToken);

    event InterestRateSet(
        address indexed bucket,
        address indexed rewardToken,
        uint256 indexed duration,
        uint256 interestRate
    );

    event MaxTotalDepositSet(address indexed bucket, uint256 maxTotalDeposit);

    struct DepositParams {
        address bucket;
        uint256 amount;
        uint256 duration;
        bool isPToken;
        address depositReceiver;
        address rewardToken;
        bytes[][] pullOracleData;
        uint256[] pullOracleTypes;
        bytes borrowedRewardAssetOracleData;
    }

    struct RewardParameters {
        address bucket;
        address[] rewardTokens;
        uint256[][] durations;
        uint256[][] newInterestRates;
        uint256 maxTotalDeposit;
    }

    struct DepositInfo {
        uint256 depositId;
        address owner;
        address bucket;
        uint256 scaledAmount;
        uint256 entryLiquidityIndex;
        uint256 deadline;
        uint256 depositStart;
        uint256 rewardAmount;
        uint256 claimedReward;
        address rewardToken;
    }

    /**
     * @notice Initializes the contract with the specified parameters.
     * @param registry The address of the PrimexRegistry contract.
     * @param primexDNS The address of the PrimexDNS contract.
     * @param priceOracle The address of the PriceOracle contract.
     * @param whiteBlackList The address of the WhiteBlackList contract.
     */
    function initialize(address registry, address primexDNS, address priceOracle, address whiteBlackList) external;

    /**
     * @notice Set the tierManager
     * @dev Only BIG_TIMELOCK_ADMIN can call it.
     * @param _tierManager tierManager The address of the TierManager contract
     */
    function setTiersManager(address _tierManager) external;

    /**
     * @notice Set the magicTierCoefficient
     * @dev Only MEDIUM_TIMELOCK_ADMIN can call it.
     * @param _magicTierCoefficient A coefficient by which to multiply if the msg.sender has the magic tier
     */
    function setMagicTierCoefficient(uint256 _magicTierCoefficient) external;

    /**
     * @notice Creates a new fixed term deposit for the caller, deposits the
     * borrowedAsset into the bucket on behalf of the contract and pays the rewards.
     * @param params Parameters for opening a new deposit
     */
    function deposit(DepositParams calldata params) external payable;

    /**
     * @notice Unlocks caller's deposits by their IDs. Transfers P-tokens or withdraws underlying tokens.
     * @param depositId an array of an unique id of the deposit
     * @param receivers An array of destination addresses
     * @param shouldWithdraw Flags to indicate whether withdraw the underlying token
     */
    function unlock(
        uint256[] calldata depositId,
        address[] calldata receivers,
        bool[] calldata shouldWithdraw
    ) external;

    /**
     * @notice Set the RewardParameters for buckets.
     * @dev Only BIG_TIMELOCK_ADMIN can call it.
     * @param params An array of reward parameters
     */
    function setRewardParameters(RewardParameters[] calldata params) external;

    /**
     * @notice Allows the BIG_TIMELOCK_ADMIN to withdraw any ERC-20 token except bucket's p-tokens
     * @param tokens an array of the tokens
     * @param amounts an array of the amounts
     * @param recipient The recipient address
     */
    function withdrawUnclaimedReward(address[] calldata tokens, uint256[] calldata amounts, address recipient) external;

    /**
     * @notice Returns an array of all deposits.
     * @return deposit An array of all `Deposit` structures.
     * @param cursor The cursor value for pagination.
     * @param count The number of positions to retrieve.
     */
    function getDeposits(
        uint256 cursor,
        uint256 count
    ) external view returns (Deposit[] memory deposit, uint256 newCursor);

    /**
     * @notice Returns Deposit by Id.
     * @return deposit `Deposit` structure .
     */
    function getDepositById(uint256 depositId) external view returns (Deposit memory deposit);

    /**
     * @notice Returns the total number of deposits.
     * @return The total number of deposits.
     */
    function getAllDepositsLength() external view returns (uint256);

    /**
     * @notice Returns the list of possible deposit durations for the bucket.
     * @param bucket The address of the bucket.
     * @param rewardToken The address of the rewardToken.
     * @return possibleDurations An array of possible deposit durations.
     */
    function getBucketPosibleDurations(
        address bucket,
        address rewardToken
    ) external view returns (uint256[] memory possibleDurations);

    /**
     * @notice Returns the list of tokens that can be used as rewards.
     * @return rewardTokens An array of addresses of reward tokens for the bucket.
     */
    function getBucketRewardTokens(address bucket) external view returns (address[] memory rewardTokens);

    /**
     * @notice Returns an array of deposits for a specific user.
     * @param user The address of the user.
     * @param cursor The cursor value for pagination.
     * @param count The number of positions to retrieve.
     * @return userDepositsData An array of `Deposit` structures belonging to the user.
     * @return newCursor The new cursor value for pagination.
     */
    function getDepositsByUser(
        address user,
        uint256 cursor,
        uint256 count
    ) external view returns (DepositInfo[] memory userDepositsData, uint256 newCursor);

    /**
     * @notice Returns an array of deposits for a specific bucket.
     * @param bucket The address of the bucket.
     * @param cursor The cursor value for pagination.
     * @param count The number of positions to retrieve.
     * @return bucketDepositsData An array of `Deposit` structures associated with the bucket.
     * @return newCursor The new cursor value for pagination.
     */
    function getDepositsByBucket(
        address bucket,
        uint256 cursor,
        uint256 count
    ) external view returns (DepositInfo[] memory bucketDepositsData, uint256 newCursor);

    /**
     * @notice Returns an array of depositIds for a specific user.
     * @param user The address of the user.
     */
    function getUserDepositIds(address user) external view returns (uint256[] memory);

    /**
     * @notice Returns an array of depositIds for a specific bucket.
     * @param bucket The address of the bucket.
     */
    function getBucketDepositIds(address bucket) external view returns (uint256[] memory);

    /**
     * @notice Computes the claimable amount of reward tokens for the given deposit id
     * @return the vested amount
     */

    function computeClaimableAmount(uint256 _depositId) external view returns (uint256);

    /**
     * @notice Claim reward tokens for the given idss
     * @param _depositIds an array of deposit ids
     * @param _receivers an array receivers's addresses
     */
    function claimRewardTokens(uint256[] calldata _depositIds, address[] calldata _receivers) external;

    /**
     * @dev Returns the amount of tokens that can be withdrawn by the owner.
     */

    function getWithdrawableAmount(address _rewardToken) external view returns (uint256 amount);

    /**
     * @dev Returns the full info about the deposit by its id
     */
    function getDepositInfoById(uint256 _depositId) external view returns (DepositInfo memory);
}
