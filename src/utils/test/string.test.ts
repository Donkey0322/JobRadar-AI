import { describe, expect, it } from "vitest";

import { cleanText, stripLegalSuffix } from "../string";

describe("stripLegalSuffix", () => {
  it.each([
    ["GitHub, Inc.", "GitHub"],
    ["Advanced Micro Devices, Inc", "Advanced Micro Devices"],
    ["Foundation Finance Company, LLC", "Foundation Finance Company"],
    ["Aon Corporation", "Aon"],
    ["Acme Ltd.", "Acme"],
    ["Integration Innovation, Inc. (i3)", "Integration Innovation, Inc. (i3)"],
    ["MSA, The Safety Company", "MSA, The Safety Company"],
    ["Incyte", "Incyte"],
    ["Inc", "Inc"],
  ])("%s → %s", (name, expected) => {
    expect(stripLegalSuffix(name)).toBe(expected);
  });
});

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
