// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {TokenApproveLibrary} from "../libraries/TokenApproveLibrary.sol";
import {TokenTransfersLibrary} from "../libraries/TokenTransfersLibrary.sol";
import "../libraries/Errors.sol";

import "./BucketStorage.sol";
import {IBucketExtension} from "./IBucketExtension.sol";
import {IBucket} from "./IBucket.sol";
import {VAULT_ACCESS_ROLE} from "../Constants.sol";
import {ISwapManager} from "../SwapManager/ISwapManager.sol";

contract BucketExtension is IBucketExtension, BucketStorageV2 {
    /**
     * @inheritdoc IBucketExtension
     */
    function depositFromBucket(
        string calldata _bucketTo,
        ISwapManager _swapManager,
        PrimexPricingLibrary.MegaRoute[] calldata _megaRoutes,
        uint256 _amountOutMin
    ) external override nonReentrant {
        _notBlackListed();
        // don't need check that _bucketTo isn't this bucket name
        // tx will be reverted by ReentrancyGuard
        _require(
            !LMparams.isBucketLaunched && block.timestamp > LMparams.deadlineTimestamp,
            Errors.DEADLINE_IS_NOT_PASSED.selector
        );
        if (isReinvestToAaveEnabled && aaveDeposit > 0) {
            withdrawBucketLiquidityFromAave();
        }
        IBucket receiverBucket = IBucket(dns.getBucketAddress(_bucketTo));

        LMparams.liquidityMiningRewardDistributor.reinvest(
            name,
            _bucketTo,
            msg.sender,
            receiverBucket.getLiquidityMiningParams().isBucketLaunched,
            LMparams.deadlineTimestamp
        );

        uint256 allUserBalance = pToken.burn(msg.sender, type(uint256).max, liquidityIndex);
        emit Withdraw(msg.sender, address(receiverBucket), allUserBalance);
        IERC20Metadata bucketToAsset = receiverBucket.borrowedAsset();
        if (bucketToAsset != borrowedAsset) {
            // Need this check that _swapManager is legit.
            // Without it, user can specify any address of _swapManager to withdraw their funds with an extra reward
            _require(
                IAccessControl(registry).hasRole(VAULT_ACCESS_ROLE, address(_swapManager)),
                Errors.FORBIDDEN.selector
            );
            TokenApproveLibrary.doApprove(address(borrowedAsset), address(_swapManager), allUserBalance);
            allUserBalance = _swapManager.swap(
                ISwapManager.SwapParams({
                    tokenA: address(borrowedAsset),
                    tokenB: address(bucketToAsset),
                    amountTokenA: allUserBalance,
                    amountOutMin: _amountOutMin,
                    megaRoutes: _megaRoutes,
                    receiver: address(receiverBucket),
                    deadline: block.timestamp,
                    isSwapFromWallet: true,
                    isSwapToWallet: true,
                    isSwapFeeInPmx: false,
                    tokenAtokenBOracleData: new bytes(0),
                    pmxPositionAssetOracleData: new bytes(0),
                    nativePositionAssetOracleData: new bytes(0),
                    pullOracleData: new bytes[](0)
                }),
                0,
                false
            );
        } else {
            TokenTransfersLibrary.doTransferOut(address(borrowedAsset), address(receiverBucket), allUserBalance);
        }

        receiverBucket.receiveDeposit(msg.sender, allUserBalance, LMparams.stabilizationDuration, name);
    }

    /**
     * @inheritdoc IBucketExtension
     */
    function withdrawBucketLiquidityFromAave() public override {
        address aavePool = dns.aavePool();
        uint256 aaveBalance = IAToken(IPool(aavePool).getReserveData(address(borrowedAsset)).aTokenAddress).balanceOf(
            address(this)
        );
        isReinvestToAaveEnabled = false;
        if (aaveBalance == 0) return;

        IPool(aavePool).withdraw(address(borrowedAsset), type(uint256).max, address(this));
        emit WithdrawFromAave(aavePool, aaveBalance);

        // if there is earned interest, withdraw it to treasury
        if (aaveBalance > aaveDeposit) {
            uint256 interest = aaveBalance - aaveDeposit;
            TokenTransfersLibrary.doTransferOut(address(borrowedAsset), dns.treasury(), interest);
            emit TopUpTreasury(aavePool, interest);
        }
        aaveDeposit = 0;
    }

    /**
     * @notice Interface checker
     * @param _interfaceId The interface id to check
     */
    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return _interfaceId == type(IBucketExtension).interfaceId || super.supportsInterface(_interfaceId);
    }

    /**
     * @dev Function that checks if the sender is not blacklisted.
     */
    function _notBlackListed() internal view {
        _require(!whiteBlackList.isBlackListed(msg.sender), Errors.SENDER_IS_BLACKLISTED.selector);
    }
}
