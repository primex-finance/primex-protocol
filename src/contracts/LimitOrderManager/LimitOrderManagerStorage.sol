// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {WadRayMath} from "../libraries/utils/WadRayMath.sol";

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";
import {TokenTransfersLibrary} from "../libraries/TokenTransfersLibrary.sol";
import {LimitOrderLibrary} from "../libraries/LimitOrderLibrary.sol";
import "../libraries/Errors.sol";

import {IPositionManagerV2} from "../PositionManager/IPositionManager.sol";
import {ILimitOrderManagerStorage} from "./ILimitOrderManagerStorage.sol";
import {ITraderBalanceVault} from "../TraderBalanceVault/ITraderBalanceVault.sol";
import {IBucketV3} from "../Bucket/IBucket.sol";
import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";
import {IConditionalOpeningManager} from "../interfaces/IConditionalOpeningManager.sol";
import {ISwapManager} from "../SwapManager/ISwapManager.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";

abstract contract LimitOrderManagerStorage is
    ILimitOrderManagerStorage,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    ERC165Upgradeable
{
    LimitOrderLibrary.LimitOrder[] internal orders;
    uint256 public override ordersId;
    mapping(uint256 => uint256) public override orderIndexes;
    // mapping from orderId to the index in the traderOrderIds[trader] array
    mapping(uint256 => uint256) public override traderOrderIndexes;
    // mapping from trader address to the order ids array
    mapping(address => uint256[]) public override traderOrderIds;
    // mapping from orderId to the index in the bucketOrderIds[bucket] array
    mapping(uint256 => uint256) public override bucketOrderIndexes;
    // mapping from bucket address to the order ids array
    mapping(address => uint256[]) public override bucketOrderIds;
    // mapping from order to open conditions
    mapping(uint256 => LimitOrderLibrary.Condition[]) public openConditions;
    // mapping from order to close conditions
    mapping(uint256 => LimitOrderLibrary.Condition[]) public closeConditions;

    IAccessControl public override registry;
    ITraderBalanceVault public override traderBalanceVault;
    IPrimexDNSV3 public override primexDNS;
    IPositionManagerV2 public override pm;
    ISwapManager public override swapManager;
    IWhiteBlackList internal whiteBlackList;
}
