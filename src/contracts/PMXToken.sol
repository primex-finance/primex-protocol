// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PMXToken is ERC20, ERC165 {
    constructor(address _recipient) ERC20("Primex", "PMX") {
        if (_recipient == address(0)) {
            _recipient = msg.sender;
        }

        _mint(_recipient, 1000000000 * 10 ** decimals());
    }

    /**
     * @notice Interface checker
     * @param interfaceId The interface id to check
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IERC20).interfaceId || super.supportsInterface(interfaceId);
    }
}
