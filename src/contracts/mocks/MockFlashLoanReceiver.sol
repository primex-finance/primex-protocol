// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.18;
import {IFlashLoanReceiver} from "../interfaces/IFlashLoanReceiver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockFlashLoanReceiver is IFlashLoanReceiver {
    event ExecutedWithFail(address[] _assets, uint256[] _amounts, uint256[] _flashLoanFees);
    event ExecutedWithSuccess(address[] _assets, uint256[] _amounts, uint256[] _flashLoanFees);

    bool internal _failExecution;
    uint256 internal _amountToApprove;
    bool internal _simulateEOA;

    // solhint-disable-next-line comprehensive-interface
    function setFailExecutionTransfer(bool fail) public {
        _failExecution = fail;
    }

    // solhint-disable-next-line comprehensive-interface
    function setAmountToApprove(uint256 amountToApprove) public {
        _amountToApprove = amountToApprove;
    }

    // solhint-disable-next-line comprehensive-interface
    function getAmountToApprove() public view returns (uint256) {
        return _amountToApprove;
    }

    // solhint-disable-next-line comprehensive-interface
    function executeOperation(
        address[] memory assets,
        uint256[] memory amounts,
        uint256[] memory flashLoanFees,
        address, //initiator
        bytes memory params
    ) public override returns (bool) {
        if (_failExecution) {
            emit ExecutedWithFail(assets, amounts, flashLoanFees);
            return false;
        }

        for (uint256 i = 0; i < assets.length; i++) {
            //check the contract has the specified balance
            require(amounts[i] <= IERC20(assets[i]).balanceOf(address(this)), "Invalid balance for the contract");

            uint256 amountToReturn = (_amountToApprove != 0) ? _amountToApprove : amounts[i] + flashLoanFees[i];
            address flashLoanManager = abi.decode(params, (address));

            IERC20(assets[i]).approve(flashLoanManager, amountToReturn);
        }

        emit ExecutedWithSuccess(assets, amounts, flashLoanFees);

        return true;
    }
}
