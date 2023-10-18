# Code Design

These are some global design goals in Primex Contracts.

## Security in Depth
We strive to provide secure, tested, audited code. To achieve this, we need to match intention with function. Thus, documentation, code clarity, community review and security discussions are fundamental.

## Simple and Modular
Simpler code means easier audits, and better understanding of what each component does. We look for small files, small contracts, and small functions. If you can separate a contract into two independent functionalities you should probably do it.

## Naming Matters

We take our time with picking names. Code is going to be written once, and read hundreds of times. Renaming for clarity is encouraged.

## Tests

Write tests for all your code. Even though not all code in the repository is tested at the moment, we aim to test every line of code in the future.

## Check preconditions and post-conditions

A very important way to prevent vulnerabilities is to catch a contract’s inconsistent state as early as possible. This is why we want functions to check pre- and post-conditions for executing its logic.

## Code Consistency

Consistency on the way classes are used is paramount to an easier understanding of the code base. The codebase should be as unified as possible. Read existing code and get inspired before you write your own. Follow the style guidelines. Don’t hesitate to ask for help on how to best write a specific piece of code.

## Regular Audits
Following good programming practices is a way to reduce the risk of vulnerabilities, but professional code audits are still needed. We will perform regular code audits on major releases, and hire security professionals to provide independent review.

# Style Guidelines

The design guidelines have quite a high abstraction level. These style guidelines are more concrete and easier to apply, and also more opinionated. We value clean code and consistency, and those are prerequisites for us to include new code in the repository. 

## Solidity code

In order to be consistent with all the other Solidity projects, we follow the
[official recommendations documented in the Solidity style guide](http://solidity.readthedocs.io/en/latest/style-guide.html).

Any exception or additions specific to our project are documented below.

* Try to avoid acronyms and abbreviations.

* All state variables should be private.

* Private state variables should have an underscore prefix.

    ```
    contract TestContract {
      uint256 private _privateVar;
      uint256 internal _internalVar;
    }
    ```

* Parameters must not be prefixed with an underscore.

    ```
    function test(uint256 testParameter1, uint256 testParameter2) {
    ...
    }
    ```

* Internal and private functions should have an underscore prefix.

    ```
    function _testInternal() internal {
      ...
    }
    ```

    ```
    function _testPrivate() private {
      ...
    }
    ```

* Events should be emitted immediately after the state change that they
  represent, and consequently they should be named in past tense.

    ```
    function _burn(address who, uint256 value) internal {
      super._burn(who, value);
      emit TokensBurned(who, value);
    }
    ```

  Some standards (e.g. ERC20) use present tense, and in those cases the
  standard specification prevails.
  
* Interface names should have a capital I prefix.

    ```
    interface IERC777 {
    ```


## Error messages format
We use the custom errors with custom require and revert functions that save gas and contract size.
All the errors are in the separate library Errors.sol. The custom error itself is uppercased and words are divided with underscores within it.
The custom require and revert function start with an underscore prefix:

```
_require(someThing != anotherThing, Errors.SOME_ERROR_MESSAGE.selector);
_revert(Errors.SOME_ERROR_MESSAGE.selector);
```
An custom error selector is passed to the function instead of a string.

## Tests

* Tests Must be Written Elegantly

    Tests are a good way to show how to use the code, and maintaining them is extremely necessary. Don't write long tests, write helper functions to make them be as short and concise as possible (they should take just a few lines each), and use good variable names.

* Tests Must not be Random

    Inputs for tests should not be generated randomly. Accounts used to create test contracts are an exception, those can be random. Also, the type and structure of outputs should be checked.

  
Code Documentation Guidelines
======
We follow the [official recommendations documented in the Solidity NatSpec Format](https://docs.soliditylang.org/en/latest/natspec-format.html#natspec-format)

 *  we use ```/**``` and ending with ```*/``` for single or multi-line comments throughout all code base of our protocol

 ```
  /**
   * @notice This is the test function
   */
  function test(uint256 testParameter1, uint256 testParameter2) {
    ...
  }
 ```
