import { randomUUID } from 'crypto';
import { Client } from 'square';

// Configure the Square client
const client = new Client({
  accessToken: process.env.SQUARE_SANDBOX_ACCESS_TOKEN,
  environment: 'sandbox',
});

const paymentsApi = client.paymentsApi;

// BigInt serialization for JSON responses
BigInt.prototype.toJSON = function () {
  return this.toString();
};

export default defineEventHandler(async (event) => {
  console.log("=== Entering pay.post Event Handler ===");

  try {
    // Parse the request body
    const { locationId, sourceId, cartItems, userLocation } = await readBody(event);
    if (!locationId || !sourceId || !Array.isArray(cartItems) || !userLocation) {
      throw new Error("Invalid request body: Missing required fields.");
    }

    // console.log("Received Request Body:", { locationId, sourceId, cartItems, userLocation });

    // Initialize total cost
    let totalCost = 0;

    // Fetch and accumulate item prices
    for (const item of cartItems) {
      if (!item._id || !item.quantity || typeof item.quantity !== "number") {
        throw new Error(`Invalid cart item format: ${JSON.stringify(item)}`);
      }

      const price = await getPrice(item._id);
      const itemCost = price * item.quantity;

      // console.log(`Item ID: ${item._id}, Price: ${price}, Quantity: ${item.quantity}, Item Cost: ${itemCost}`);
      totalCost += itemCost;
    }

    console.log(`Total cost before tax: ${totalCost}`);

    // Fetch sales tax and add it to the total cost
    const salesTax = await fetchSalesTax(totalCost, userLocation);
    console.log(`Sales Tax fetched: ${salesTax}`);

    totalCost += salesTax;
    console.log(`Total cost after adding sales tax: ${totalCost}`);

    // Convert total cost to smallest currency unit (cents) and round
    const amountInCents = Math.round(totalCost * 100);
    console.log(`Total cost in smallest currency unit (cents): ${amountInCents}`);

    // Prepare the payment payload
    const paymentPayload = {
      locationId,
      sourceId,
      idempotencyKey: randomUUID(),
      amountMoney: {
        amount: amountInCents,
        currency: 'USD',
      },
    };
    console.log("Payment Payload:", paymentPayload);

    // Create the payment
    const result = await paymentsApi.createPayment(paymentPayload);
    console.log("Payment API Result:", result);

    return result;
  } catch (error) {
    console.error("Error in pay.post Event Handler:", error);

    if (error instanceof TypeError) {
      console.error("TypeError occurred:", error.message);
    } else if (error instanceof SyntaxError) {
      console.error("SyntaxError occurred:", error.message);
    } else if (error.response?.statusCode === 401) {
      console.error("Authentication Error: Check your Square access token.");
    } else {
      console.error("Unexpected Error:", error.message);
    }

    throw createError({ statusCode: 500, message: 'Payment processing error', cause: error });
  }
});

// Helper function to fetch the price of an item
async function getPrice(itemId) {
  // console.log(`Fetching price for item ID: ${itemId}`);
  
  try {
    const response = await $fetch(`/api/items?_id=${itemId}`);
    console.log(`Response for item ID ${itemId}:`, response);

    if (!response || typeof response.price !== 'number') {
      throw new Error(`Invalid price for item ID ${itemId}`);
    }

    return response.price;
  } catch (error) {
    console.error(`Error fetching price for item ID ${itemId}:`, error.message);
    throw error;
  }
}

// Helper function to fetch sales tax
async function fetchSalesTax(totalCost, userLocation) {
  // console.log("Fetching Sales Tax with:", { totalCost, userLocation });

  try {
    const response = await $fetch(`/api/tax/salesTax`, {
      method: 'POST',
      body: {
        totalCost,
        userLocation,
      },
    });

    if (!response || typeof response !== 'number') {
      throw new Error("Invalid response from sales tax API.");
    }

    return response;
  } catch (error) {
    console.error("Error fetching sales tax:", error.message);
    throw error;
  }
}
