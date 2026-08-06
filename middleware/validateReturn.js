const { body, validationResult } = require("express-validator");

const validateReturnRules = [
  body("orderId")
    .trim()
    .notEmpty()
    .withMessage("Order ID is required and cannot be empty."),
  
  body("customerEmail")
    .trim()
    .isEmail()
    .withMessage("A valid customer email is required."),
  
  body("customerName")
    .trim()
    .notEmpty()
    .withMessage("Customer name is required and cannot be empty."),
  
  body("orderDeliveryDate")
    .trim()
    .isISO8601()
    .withMessage("Order delivery date must be a valid ISO 8601 date string.")
    .custom((value) => {
      const deliveryDate = new Date(value);
      const now = new Date();
      if (deliveryDate > now) {
        throw new Error("Order delivery date cannot be in the future.");
      }
      return true;
    }),
  
  body("type")
    .trim()
    .isIn(["return", "exchange"])
    .withMessage("Type must be exactly 'return' or 'exchange'."),
  
  body("reason")
    .trim()
    .notEmpty()
    .withMessage("Reason is required and cannot be empty."),
  
  body("exchangeSize")
    .custom((value, { req }) => {
      if (req.body.type === "exchange" && (!value || value.trim() === "")) {
        throw new Error("Exchange size is required when the request type is 'exchange'.");
      }
      return true;
    }),
];

const validateReturn = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }
  next();
};

module.exports = [
  ...validateReturnRules,
  validateReturn
];
