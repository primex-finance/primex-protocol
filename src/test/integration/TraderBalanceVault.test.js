// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  ethers: {
    getContract,
    getNamedSigners,
    utils: { parseEther, toUtf8Bytes, keccak256 },
    constants: { NegativeOne, MaxUint256 },
  },
  deployments: { fixture },
} = require("hardhat");
const { NATIVE_CURRENCY } = require("../utils/constants");

process.env.TEST = true;

describe("TraderBalanceVault_integration", function () {
  let testTokenA, traderBalanceVault, registry, trader, deployer, amount;

  before(async function () {
    await fixture(["Test"]);
    ({ trader, deployer } = await getNamedSigners());
    testTokenA = await getContract("TestTokenA");
    registry = await getContract("Registry");
    traderBalanceVault = await getContract("TraderBalanceVault");
    const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));
    await registry.connect(deployer).grantRole(VAULT_ACCESS_ROLE, deployer.address);
    await testTokenA.mint(trader.address, parseEther("100"));

    amount = parseEther("10");
    await testTokenA.connect(trader).approve(traderBalanceVault.address, MaxUint256);
  });

  describe("deposit()", function () {
    it("Should transfer 'testTokenA' tokens from msg.sender to TraderBalanceVault contract", async function () {
      const { availableBalance: balanceBefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);

      await expect(() => traderBalanceVault.connect(trader).deposit(testTokenA.address, amount)).to.changeTokenBalances(
        testTokenA,
        [trader, traderBalanceVault],
        [amount.mul(NegativeOne), amount],
      );

      const { availableBalance: balanceAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      expect(balanceAfter).to.equal(balanceBefore.add(amount));
    });
    it("Should transfer native currency from msg.sender to TraderBalanceVault contract", async function () {
      const { availableBalance: balanceBefore } = await traderBalanceVault.balances(trader.address, NATIVE_CURRENCY);
      await expect(() => traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, { value: amount })).to.changeEtherBalances(
        [trader, traderBalanceVault],
        [amount.mul(NegativeOne), amount],
      );

      const { availableBalance: balanceAfter } = await traderBalanceVault.balances(trader.address, NATIVE_CURRENCY);
      expect(balanceAfter).to.equal(balanceBefore.add(amount));
    });
    it("Should transfer native currency from msg.sender to TraderBalanceVault contract via the receive function", async function () {
      const { availableBalance: balanceBefore } = await traderBalanceVault.balances(trader.address, NATIVE_CURRENCY);
      await expect(() =>
        trader.sendTransaction({
          to: traderBalanceVault.address,
          data: "0x",
          value: amount,
        }),
      ).to.changeEtherBalances([trader, traderBalanceVault], [amount.mul(NegativeOne), amount]);
      const { availableBalance: balanceAfter } = await traderBalanceVault.balances(trader.address, NATIVE_CURRENCY);
      expect(balanceAfter).to.equal(balanceBefore.add(amount));
    });
  });

  describe("withdraw()", function () {
    it("Should transfer 'testTokenA' tokens from TraderBalanceVault contract to msg.sender", async function () {
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, amount);
      const { availableBalance: balanceBefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);

      await expect(() => traderBalanceVault.connect(trader).withdraw(testTokenA.address, amount)).to.changeTokenBalances(
        testTokenA,
        [trader, traderBalanceVault],
        [amount, amount.mul(NegativeOne)],
      );

      const { availableBalance: balanceAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      expect(balanceAfter).to.equal(balanceBefore.sub(amount));
    });
    it("Should transfer native currency from TraderBalanceVault contract to msg.sender", async function () {
      await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, { value: amount });
      const { availableBalance: balanceBefore } = await traderBalanceVault.balances(trader.address, NATIVE_CURRENCY);

      await expect(() => traderBalanceVault.connect(trader).withdraw(NATIVE_CURRENCY, amount)).to.changeEtherBalances(
        [trader, traderBalanceVault],
        [amount, amount.mul(NegativeOne)],
      );

      const { availableBalance: balanceAfter } = await traderBalanceVault.balances(trader.address, NATIVE_CURRENCY);
      expect(balanceAfter).to.equal(balanceBefore.sub(amount));
    });
  });
});
