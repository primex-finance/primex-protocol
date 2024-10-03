// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import "./../libraries/Errors.sol";

import {IPrimexLensPart2} from "../interfaces/IPrimexLensPart2.sol";
import {IPositionManagerV2} from "../PositionManager/IPositionManager.sol";

import {IPrimexDNSV3, IPrimexDNSStorageV3} from "../PrimexDNS/PrimexDNS.sol";
import {IKeeperRewardDistributorStorage} from "../KeeperRewardDistributor/IKeeperRewardDistributorStorage.sol";
import {ARB_NITRO_ORACLE, GAS_FOR_BYTE, OVM_GASPRICEORACLE, TRANSACTION_METADATA_BYTES} from "../Constants.sol";

/**
 * @dev  All functions in this contract are intended to be called off-chain. Do not call functions from other contracts to avoid an out-of-gas error.
 */

contract PrimexLensPart2 is IPrimexLensPart2, ERC165 {
    /**
     * @inheritdoc IPrimexLensPart2
     */
    function getEstimatedMinProtocolFeeLiquidation(IPositionManagerV2 _pm) public view override returns (uint256) {
        uint256 restrictedGasPrice = PrimexPricingLibrary.calculateRestrictedGasPrice(
            address(_pm.priceOracle()),
            _pm.keeperRewardDistributor()
        );

        IPrimexDNSV3 primexDNS = _pm.primexDNS();

        (, , uint256 optimisticGasCoefficient, IKeeperRewardDistributorStorage.PaymentModel paymentModel) = _pm
            .keeperRewardDistributor()
            .getGasCalculationParams();

        (uint256 liquidationGasAmount, uint256 protocolFeeCoefficient, , , uint256 baseLength) = primexDNS
            .getParamsForMinProtocolFee(IPrimexDNSStorageV3.CallingMethod.ClosePositionByCondition);
        uint256 l1CostWei;

        if (paymentModel != IKeeperRewardDistributorStorage.PaymentModel.DEFAULT) {
            if (paymentModel == IKeeperRewardDistributorStorage.PaymentModel.ARBITRUM) {
                l1CostWei =
                    ARB_NITRO_ORACLE.getL1BaseFeeEstimate() *
                    GAS_FOR_BYTE *
                    (baseLength + TRANSACTION_METADATA_BYTES);
            }
            if (paymentModel == IKeeperRewardDistributorStorage.PaymentModel.OPTIMISTIC) {
                // Adds 68 bytes of padding to account for the fact that the input does not have a signature.
                uint256 l1GasUsed = GAS_FOR_BYTE * (baseLength + OVM_GASPRICEORACLE.overhead() + 68);
                l1CostWei =
                    (OVM_GASPRICEORACLE.l1BaseFee() *
                        l1GasUsed *
                        OVM_GASPRICEORACLE.scalar() *
                        optimisticGasCoefficient) /
                    10 ** 6;
            }
        }
        uint256 estimatedMinProtocolFeeInNativeAsset = liquidationGasAmount *
            restrictedGasPrice +
            l1CostWei +
            protocolFeeCoefficient;
        return estimatedMinProtocolFeeInNativeAsset;
    }
}
