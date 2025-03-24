// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

interface IPrimexNFTStorage {
    function registry() external returns (IAccessControl);

    function idToDeadLine(uint256 _id) external returns (uint256);
}
