// ============================================================
// DAY 08 — CLASSES UNDER THE HOOD
// ============================================================
// Run this in a browser console, via index.html, or with `node script.js`.

// ============================================================
// 1. HAPPY PATH — class is sugar over the prototype chain
// ============================================================

class Animal {
  constructor(name) {
    this.name = name;
  }

  // This desugars to a non-enumerable function placed on Animal.prototype --
  // NOT inside the constructor, so every instance shares one function object.
  speak() {
    return `${this.name} makes a sound`;
  }

  // Static methods attach to the CLASS/constructor function itself, never to
  // .prototype -- so instances can never call this directly.
  static create(name) {
    return new Animal(name);
  }
}

const rex = new Animal('Rex');
console.log('[1] rex.speak() ->', rex.speak());
console.log('[1b] rex.__proto__ === Animal.prototype ->', rex.__proto__ === Animal.prototype);

// ============================================================
// 2. EDGE CASE — class constructors cannot be called without `new`
// ============================================================

try {
  // WHY this throws: V8 marks class constructors with an internal flag that
  // makes [[Call]] (invocation without `new`) explicitly throw, instead of
  // silently running with a wrong/missing `this` the way an old-style
  // constructor FUNCTION would.
  // eslint-disable-next-line new-cap
  Animal('Not using new');
} catch (err) {
  console.log('[2] calling class without new -> threw:', err.constructor.name, '-', err.message);
}

// ============================================================
// 3. EDGE CASE — class methods are non-enumerable (real, observable difference)
// ============================================================

console.log('[3] Object.keys(rex) ->', Object.keys(rex));
// Only 'name' shows up -- 'speak' lives on the prototype AND is non-enumerable,
// so it is invisible to both Object.keys and for...in.
const forInKeys = [];
for (const key in rex) {
  forInKeys.push(key);
}
console.log('[3b] for...in over rex ->', forInKeys);

// Contrast with the OLD manual pattern from Day 07, where prototype methods
// assigned with plain `=` ARE enumerable by default:
function OldStyleAnimal(name) {
  this.name = name;
}
OldStyleAnimal.prototype.speak = function () {
  return `${this.name} makes a sound`;
};
const oldRex = new OldStyleAnimal('OldRex');
const oldForInKeys = [];
for (const key in oldRex) {
  oldForInKeys.push(key);
}
console.log('[3c] for...in over OLD-STYLE instance (speak IS visible) ->', oldForInKeys);

// ============================================================
// 4. HAPPY PATH — extends wires up TWO separate prototype links
// ============================================================

class Dog extends Animal {
  bark() {
    return `${this.name} says woof`;
  }
}

const fido = new Dog('Fido');

// Link 1: the INSTANCE chain -- fido -> Dog.prototype -> Animal.prototype
console.log('[4] fido.speak() via instance chain ->', fido.speak());
console.log(
  '[4b] Dog.prototype.__proto__ === Animal.prototype ->',
  Dog.prototype.__proto__ === Animal.prototype
);

// Link 2: the STATIC chain -- Dog -> Animal (completely separate from Link 1)
// This is what lets Dog.create(...) find Animal's static method, even though
// Dog never defined its own `create`.
console.log('[4c] Dog.__proto__ === Animal ->', Dog.__proto__ === Animal);
const createdDog = Dog.create('Via Static Chain');
console.log('[4d] Dog.create(...) returns instanceof Animal ->', createdDog instanceof Animal);
// Note: the static chain does NOT make Dog.create return a Dog -- Animal.create
// hardcodes `new Animal(...)`, proving statics are inherited by REFERENCE, not
// magically re-bound to the subclass.
console.log('[4e] Dog.create(...) instanceof Dog ->', createdDog instanceof Dog);

// Static methods are never reachable from an INSTANCE -- only from the class itself.
console.log('[4f] fido.create (instance access) ->', fido.create);

// ============================================================
// 5. COMMON PITFALL — `this` does not exist until super() runs in a derived class
// ============================================================

class BrokenDog extends Animal {
  constructor(name, breed) {
    // WHY this throws: a DERIVED class constructor does not receive a `this`
    // binding from [[Construct]] the way a base class does. `super(name)` is
    // what actually obtains `this` from the parent chain. Touching `this`
    // before that call runs is a ReferenceError, not `undefined`.
    try {
      this.breed = breed; // eslint-disable-line no-unused-expressions
    } catch (err) {
      console.log('[5] touching `this` before super() -> threw:', err.constructor.name);
    }
    super(name); // this is where `this` actually gets created/initialized
    this.breed = breed; // safe now
  }
}

const broken = new BrokenDog('Rex', 'Labrador');
console.log('[5b] after super() runs, this works fine ->', broken.name, broken.breed);

// ============================================================
// 6. EDGE CASE — private fields (#field) are a real, unreachable engine slot
// ============================================================

class BankAccount {
  // A true private slot -- not a string key, not a Symbol, not reachable via
  // bracket notation, Object.keys, Reflect.ownKeys, or JSON.stringify.
  #balance;

  constructor(initialBalance) {
    this.#balance = initialBalance;
  }

  deposit(amount) {
    this.#balance += amount;
    return this.#balance;
  }

  // Only code INSIDE this class can ever reference #balance by name.
  getBalance() {
    return this.#balance;
  }
}

const account = new BankAccount(100);
account.deposit(50);
console.log('[6] account.getBalance() ->', account.getBalance());

// Proof that #balance is truly invisible from the outside:
console.log('[6b] Object.keys(account) ->', Object.keys(account));
console.log('[6c] JSON.stringify(account) ->', JSON.stringify(account));
console.log('[6d] Reflect.ownKeys(account) ->', Reflect.ownKeys(account));
// The following line is intentionally commented out: uncommenting it is a
// SyntaxError at PARSE time (not a runtime undefined), because `#balance` is
// not a private name declared in ANY class in scope at this point in the file.
// console.log(account.#balance);

// ============================================================
// 7. EDGE CASE — static fields and static initialization blocks
// ============================================================

class ConfigRegistry {
  // Static fields attach to the class itself at class-definition time, once --
  // not per instance.
  static #instanceCount = 0;
  static version = '1.0.0';

  constructor() {
    ConfigRegistry.#instanceCount += 1;
  }

  static getInstanceCount() {
    return ConfigRegistry.#instanceCount;
  }
}

new ConfigRegistry();
new ConfigRegistry();
new ConfigRegistry();
console.log('[7] static private counter across instances ->', ConfigRegistry.getInstanceCount());
console.log('[7b] static public field ->', ConfigRegistry.version);

// ============================================================
// 8. EDGE CASE — class fields with arrow functions for auto-bound `this`
// ============================================================

class ClickHandler {
  label = 'click-handler';

  // This is an arrow-valued class FIELD, not a class method. It is created
  // fresh PER INSTANCE (unlike prototype methods, which are shared), and it
  // captures `this` lexically at the point the field initializer runs --
  // which is during construction, with `this` already bound to the new
  // instance. This is why it stays correctly bound even when detached.
  handleClick = () => {
    return `handled by ${this.label}`;
  };
}

const handlerInstance = new ClickHandler();
const detachedHandler = handlerInstance.handleClick; // simulate passing it as a bare callback
console.log('[8] detached arrow field still bound correctly ->', detachedHandler());
