// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {PrimexPricingLibrary} from "../libraries/PrimexPricingLibrary.sol";

import {IBucketV3} from "../Bucket/IBucket.sol";
import {IDebtToken} from "../DebtToken/IDebtToken.sol";
import {IPrimexDNSV3} from "../PrimexDNS/IPrimexDNS.sol";
import {IPositionManagerV2} from "../PositionManager/IPositionManager.sol";
import {IPriceOracleV2} from "../PriceOracle/IPriceOracle.sol";
import {IPToken} from "../PToken/IPToken.sol";
import {IReserve} from "../Reserve/IReserve.sol";
import {IBucketMock} from "./mocksInterfaces/IBucketMock.sol";
import {IWhiteBlackList} from "../WhiteBlackList/WhiteBlackList/IWhiteBlackList.sol";
import {ILiquidityMiningRewardDistributor} from "../LiquidityMiningRewardDistributor/ILiquidityMiningRewardDistributor.sol";
import {IInterestRateStrategy} from "../interfaces/IInterestRateStrategy.sol";
import {ISwapManager} from "../SwapManager/ISwapManager.sol";

contract BucketMock is IBucketV3, IERC165, IBucketMock {
    IDebtToken public override debtToken;
    IPToken public override pToken;
    bool public override isActive;
    bool public override isDelisted;
    IWhiteBlackList public whiteBlackList;
    uint256 public normalizedIncome = 1e28;
    // solhint-disable-next-line var-name-mixedcase
    LiquidityMiningParams private LMparams;
    // default true, to pass tests
    bool private isClaimable = true;

    function setInterestRateStrategy(address _interestRateStrategy) external override {}

    function batchDecreaseTradersDebt(
        address[] memory _traders,
        uint256[] memory _debtsToBurn,
        address _traderBalanceVault,
        uint256 _totalProfit,
        uint256 _permanentLossAmount,
        uint256 _length
    ) external override {}

    function getNormalizedIncome() external view override returns (uint256) {
        return normalizedIncome;
    }

    //DebtToken
    function setDebtToken(address _debtToken) public override {
        debtToken = IDebtToken(_debtToken);
    }

    function mintDebtToken(address _trader, uint256 _amount, uint256 _index) public override {
        debtToken.mint(_trader, _amount, _index);
    }

    function burnDebtToken(address _trader, uint256 _amount, uint256 _index) public override {
        debtToken.burn(_trader, _amount, _index);
    }

    function setVariableBorrowIndex(uint128 _variableBorrowIndex) public override {
        variableBorrowIndex = _variableBorrowIndex;
    }

    //PToken
    function setPToken(address _pToken) public override {
        pToken = IPToken(_pToken);
    }

    function setWhiteBlackList(address _whiteBlackList) public override {
        whiteBlackList = IWhiteBlackList(_whiteBlackList);
    }

    function mintPToken(address _trader, uint256 _amount, uint256 _index) public override {
        pToken.mint(_trader, _amount, _index);
    }

    function burnPToken(address _trader, uint256 _amount, uint256 _index) public override {
        pToken.burn(_trader, _amount, _index);
    }

    function setLiquidityIndex(uint128 _liquidityIndex) public override {
        liquidityIndex = _liquidityIndex;
    }

    function setNormalizedIncome(uint256 _normalizedIncome) public override {
        normalizedIncome = _normalizedIncome;
    }

    //original methods
    /* solhint-disable no-unused-vars */
    string public override name;
    address public override registry;
    IPrimexDNSV3 internal dns;
    IPositionManagerV2 public override positionManager;
    IPriceOracleV2 internal priceOracle;
    IERC20Metadata public override borrowedAsset;
    uint256 public override feeBuffer;
    uint256 public override withdrawalFeeRate;
    // bar = borrowing annual rate (originally APR)
    uint128 public override bar;
    // lar = lending annual rate (originally APY)
    uint128 public override lar;
    uint128 public override estimatedBar;
    uint128 public override estimatedLar;
    uint128 public override liquidityIndex = 1e27;
    uint128 public override variableBorrowIndex = 1e27;
    uint256 public override maxTotalDeposit;
    mapping(address => Asset) public override allowedAssets;

    function initialize(ConstructorParams memory _params, address _registry) external override {}

    function removeAsset(address _assetToDelete) external override {}

    function setBucketExtension(address _newBucketExtension) external override {}

    function setReserveRate(uint256 _fee) external override {}

    function setFeeBuffer(uint256 _feeBuffer) external override {}

    function setMaxTotalDeposit(uint256 _maxTotalDeposit) external override {}

    function setWithdrawalFee(uint256 _withdrawalFee) external override {}

    function setBarCalculationParams(bytes memory _params) external override {}

    function withdrawAfterDelisting(uint256 _amount) external override {}

    function receiveDeposit(
        address _pTokenReceiver,
        uint256 _amount,
        uint256 _duration,
        string memory _bucketFrom
    ) external override {}

    function depositFromBucket(
        string calldata _bucketTo,
        ISwapManager _swapManager,
        PrimexPricingLibrary.MegaRoute[] calldata megaRoutes,
        uint256 _amountOutMin
    ) external override {}

    function returnLiquidityFromAaveToBucket() external override {}

    function setActive(bool _active) external override returns (bool) {
        isActive = _active;
        return _active;
    }

    function setDelisted(bool _delisted) external override returns (bool) {
        isDelisted = _delisted;
        return _delisted;
    }

    function deposit(address _pTokenReceiver, uint256 _amount) external override {}

    function deposit(address _pTokenReceiver, uint256 _amount, bool _takeDepositFromWallet) external override {}

    function withdraw(address _borrowAssetReceiver, uint256 _amount) external override {}

    function increaseDebt(address _trader, uint256 _amount, address _to) external override {}

    function decreaseTraderDebt(
        address _trader,
        uint256 _debtToBurn,
        address _traderBalanceVault,
        uint256 _profitToTrader,
        uint256 _permanentLossAmount
    ) external override {}

    function setLiquidityMiningParams(LiquidityMiningParams memory _newLMparams) external override {
        LMparams = _newLMparams;
    }

    function setCanClaimReward(bool _isClaimable) external override {
        isClaimable = _isClaimable;
    }

    function isDeprecated() external view override returns (bool) {}

    function isWithdrawAfterDelistingAvailable() external view override returns (bool) {}

    function getLiquidityMiningParams() external view override returns (LiquidityMiningParams memory) {
        return LMparams;
    }

    function isBucketStable() external view override returns (bool) {
        return isClaimable;
    }

    function permanentLoss() external view override returns (uint256) {}

    function interestRateStrategy() external view override returns (IInterestRateStrategy) {}

    function maxAssetLeverage(address _asset) external pure override returns (uint256) {
        _asset = address(0);
        return 1;
    }

    function maxAssetLeverage(address _asset, uint256 _feeRate) external pure override returns (uint256) {
        _asset = address(0);
        _feeRate = 0;
        return 1;
    }

    function getNormalizedVariableDebt() external pure override returns (uint256) {
        return 1;
    }

    function getAllowedAssets() external pure override returns (address[] memory) {
        address[] memory returnValue = new address[](1);
        return returnValue;
    }

    function addAsset(address _newAsset) public override {}

    function paybackPermanentLoss(uint256 amount) public override {}

    function permanentLossScaled() public view override returns (uint256) {}

    function reserve() public view override returns (IReserve) {}

    /// @notice Interface checker
    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return _interfaceId == type(IBucketV3).interfaceId || _interfaceId == type(IERC165).interfaceId;
    }

    function availableLiquidity() public pure override returns (uint256) {
        return 1;
    }

    /* solhint-enable no-unused-vars */
}
