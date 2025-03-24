// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ParaswapMock {
    address private constant ETH_ADDRESS = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);

    uint256 private constant MAX_UINT = type(uint256).max;

    enum CurveSwapType {
        EXCHANGE,
        EXCHANGE_UNDERLYING,
        EXCHANGE_GENERIC_FACTORY_ZAP
    }

    /**
     * @param fromToken Address of the source token
     * @param fromAmount Amount of source tokens to be swapped
     * @param toAmount Minimum destination token amount expected out of this swap
     * @param expectedAmount Expected amount of destination tokens without slippage
     * @param beneficiary Beneficiary address
     * 0 then 100% will be transferred to beneficiary. Pass 10000 for 100%
     * @param path Route to be taken for this swap to take place
     */
    struct SellData {
        address fromToken;
        uint256 fromAmount;
        uint256 toAmount;
        uint256 expectedAmount;
        address payable beneficiary;
        Path[] path;
        address payable partner;
        uint256 feePercent;
        bytes permit;
        uint256 deadline;
        bytes16 uuid;
    }

    struct BuyData {
        address adapter;
        address fromToken;
        address toToken;
        uint256 fromAmount;
        uint256 toAmount;
        uint256 expectedAmount;
        address payable beneficiary;
        Route[] route;
        address payable partner;
        uint256 feePercent;
        bytes permit;
        uint256 deadline;
        bytes16 uuid;
    }

    struct MegaSwapSellData {
        address fromToken;
        uint256 fromAmount;
        uint256 toAmount;
        uint256 expectedAmount;
        address payable beneficiary;
        MegaSwapPath[] path;
        address payable partner;
        uint256 feePercent;
        bytes permit;
        uint256 deadline;
        bytes16 uuid;
    }

    struct SimpleData {
        address fromToken;
        address toToken;
        uint256 fromAmount;
        uint256 toAmount;
        uint256 expectedAmount;
        address[] callees;
        bytes exchangeData;
        uint256[] startIndexes;
        uint256[] values;
        address payable beneficiary;
        address payable partner;
        uint256 feePercent;
        bytes permit;
        uint256 deadline;
        bytes16 uuid;
    }

    struct DirectUniV3 {
        address fromToken;
        address toToken;
        address exchange;
        uint256 fromAmount;
        uint256 toAmount;
        uint256 expectedAmount;
        uint256 feePercent;
        uint256 deadline;
        address payable partner;
        bool isApproved;
        address payable beneficiary;
        bytes path;
        bytes permit;
        bytes16 uuid;
    }

    struct DirectCurveV1 {
        address fromToken;
        address toToken;
        address exchange;
        uint256 fromAmount;
        uint256 toAmount;
        uint256 expectedAmount;
        uint256 feePercent;
        int128 i;
        int128 j;
        address payable partner;
        bool isApproved;
        CurveSwapType swapType;
        address payable beneficiary;
        bool needWrapNative;
        bytes permit;
        bytes16 uuid;
    }

    struct DirectCurveV2 {
        address fromToken;
        address toToken;
        address exchange;
        address poolAddress;
        uint256 fromAmount;
        uint256 toAmount;
        uint256 expectedAmount;
        uint256 feePercent;
        uint256 i;
        uint256 j;
        address payable partner;
        bool isApproved;
        CurveSwapType swapType;
        address payable beneficiary;
        bool needWrapNative;
        bytes permit;
        bytes16 uuid;
    }

    struct Adapter {
        address payable adapter;
        uint256 percent;
        uint256 networkFee; //NOT USED
        Route[] route;
    }

    struct Route {
        uint256 index; //Adapter at which index needs to be used
        address targetExchange;
        uint256 percent;
        bytes payload;
        uint256 networkFee; //NOT USED - Network fee is associated with 0xv3 trades
    }

    struct MegaSwapPath {
        uint256 fromAmountPercent;
        Path[] path;
    }

    struct Path {
        address to;
        uint256 totalNetworkFee; //NOT USED - Network fee is associated with 0xv3 trades
        Adapter[] adapters;
    }

    constructor() {}

    // solhint-disable-next-line comprehensive-interface
    function getTokenTransferProxy() external view returns (address) {
        return address(this);
    }

    /**
     * @dev The function which performs the multi path swap.
     * @param data Data required to perform swap.
     */
    // solhint-disable-next-line comprehensive-interface
    function multiSwap(SellData memory data) public payable returns (uint256) {
        require(data.deadline >= block.timestamp, "Deadline breached");

        address fromToken = data.fromToken;
        uint256 fromAmount = data.fromAmount;
        require(msg.value == (fromToken == ETH_ADDRESS ? fromAmount : 0), "Incorrect msg.value");
        uint256 toAmount = data.toAmount;
        uint256 expectedAmount = data.expectedAmount;
        address payable beneficiary = data.beneficiary == address(0) ? payable(msg.sender) : data.beneficiary;
        Path[] memory path = data.path;
        address toToken = path[path.length - 1].to;

        require(toAmount > 0, "To amount can not be 0");

        transferTokensFrom(fromToken, fromAmount);

        transferTokens(toToken, beneficiary, expectedAmount);
    }

    function transferTokens(address token, address payable destination, uint256 amount) internal {
        if (amount > 0) {
            if (token == ETH_ADDRESS) {
                // solhint-disable-next-line avoid-low-level-calls
                (bool result, ) = destination.call{value: amount, gas: 10000}("");
                require(result, "Failed to transfer Ether");
            } else {
                IERC20(token).transfer(destination, amount);
            }
        }
    }

    function transferTokensFrom(address token, uint256 amount) internal {
        if (token != ETH_ADDRESS) {
            IERC20(token).transferFrom(msg.sender, address(this), amount);
        }
    }

    /**
     * @dev The function which performs the single path buy.
     * @param data Data required to perform swap.
     */
    // solhint-disable-next-line comprehensive-interface
    function buy(BuyData memory data) public payable returns (uint256) {
        address fromToken = data.fromToken;
        uint256 fromAmount = data.fromAmount;
        uint256 toAmount = data.toAmount;
        address payable beneficiary = data.beneficiary == address(0) ? payable(msg.sender) : data.beneficiary;
        address toToken = data.toToken;

        transferTokensFrom(fromToken, fromAmount);
        transferTokens(toToken, beneficiary, toAmount);
        return toAmount;
    }

    /**
     * @dev The function which performs the mega path swap.
     * @param data Data required to perform swap.
     */
    // solhint-disable-next-line comprehensive-interface
    function megaSwap(MegaSwapSellData memory data) public payable returns (uint256) {
        require(data.deadline >= block.timestamp, "Deadline breached");
        address fromToken = data.fromToken;
        uint256 fromAmount = data.fromAmount;
        require(msg.value == (fromToken == ETH_ADDRESS ? fromAmount : 0), "Incorrect msg.value");

        uint256 expectedAmount = data.expectedAmount;
        address payable beneficiary = data.beneficiary == address(0) ? payable(msg.sender) : data.beneficiary;
        MegaSwapPath[] memory path = data.path;
        address toToken = path[0].path[path[0].path.length - 1].to;

        transferTokensFrom(fromToken, fromAmount);

        transferTokens(toToken, beneficiary, expectedAmount);
    }
}
