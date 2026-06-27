import { describe, expect, it } from "vitest";

import { cleanText } from "./string";

describe("cleanText", () => {
  it("should collapse multiple spaces into a single space", () => {
    // Arrange
    const input = "Hello     World";

    // Act
    const result = cleanText(input);

    // Assert
    const expected = "Hello World";
    expect(result).toBe(expected);
  });

  it("should replace newlines and tabs with spaces", () => {
    // Arrange
    const input = "Hello\n\tWorld";

    // Act
    const result = cleanText(input);

    // Assert
    const expected = "Hello World";
    expect(result).toBe(expected);
  });

  it("should trim leading and trailing whitespace", () => {
    // Arrange
    const input = "   Hello World   ";

    // Act
    const result = cleanText(input);

    // Assert
    const expected = "Hello World";
    expect(result).toBe(expected);
  });

  it("should return an empty string when input contains only whitespace", () => {
    // Arrange
    const input = " \n\t  ";

    // Act
    const result = cleanText(input);

    // Assert
    const expected = "";
    expect(result).toBe(expected);
  });

  it("should leave already clean text unchanged", () => {
    // Arrange
    const input = "Hello World";

    // Act
    const result = cleanText(input);

    // Assert
    const expected = "Hello World";
    expect(result).toBe(expected);
  });
});
