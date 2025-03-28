// SPDX-License-Identifier: UNLICENSED
/* solhint-disable */

pragma solidity >=0.5.0 <0.9.0;

contract MockStork {
    function getEthSignedMessageHash32(bytes32 message) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", message));
    }

    function getMessageHash(
        address oracle_name,
        string memory asset_pair_id,
        uint256 timestamp,
        uint256 price
    ) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(oracle_name, asset_pair_id, timestamp, price));
    }

    function getSigner(bytes32 signed_message_hash, bytes32 r, bytes32 s, uint8 v) private pure returns (address) {
        return ecrecover(signed_message_hash, v, r, s);
    }

    function verifySignature(
        address oracle_pubkey,
        string memory asset_pair_id,
        uint256 timestamp,
        uint256 price,
        bytes32 r,
        bytes32 s,
        uint8 v
    ) public pure returns (bool) {
        bytes32 msg_hash = getMessageHash(oracle_pubkey, asset_pair_id, timestamp, price);
        bytes32 signed_message_hash = getEthSignedMessageHash32(msg_hash);

        // Verify hash was generated by the actual user
        address signer = getSigner(signed_message_hash, r, s, v);
        return (signer == oracle_pubkey) ? true : false;
    }
}
