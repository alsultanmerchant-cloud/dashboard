import { describe, expect, test } from "bun:test";
import { resolveClientName } from "./clients";

describe("resolveClientName", () => {
  test("a live service contract names the client ahead of a newer closed sibling", () => {
    expect(
      resolveClientName(
        "النوى العشبية",
        [
          {
            sheet_client_name: "مؤسسة النوى العشبية - لاندينج",
            start_date: "2026-04-07",
            status: "closed",
            sheet_present: true,
          },
          {
            sheet_client_name: "مؤسسة النوى العشبية - سوشيال",
            start_date: "2026-03-31",
            status: "active",
            sheet_present: true,
          },
          {
            sheet_client_name: "مؤسسة النوى العشبية - حملات",
            start_date: "2026-03-30",
            status: "closed",
            sheet_present: true,
          },
        ],
        "odoo",
      ),
    ).toBe("مؤسسة النوى العشبية - سوشيال");
  });

  test("a vanished sheet row cannot override the current contract name", () => {
    expect(
      resolveClientName("اسم أودو", [
        {
          sheet_client_name: "اسم قديم",
          start_date: "2026-07-01",
          status: "active",
          sheet_present: false,
        },
        {
          sheet_client_name: "الاسم الحالي",
          start_date: "2026-06-01",
          status: "active",
          sheet_present: true,
        },
      ]),
    ).toBe("الاسم الحالي");
  });

  test("a sheet-native client keeps its stable name when every contract ended", () => {
    expect(
      resolveClientName(
        "اسم العميل الموحّد",
        [
          {
            sheet_client_name: "اسم العميل - خدمة قديمة",
            start_date: "2026-01-01",
            status: "closed",
            sheet_present: true,
          },
        ],
        "excel-acc-sheet",
      ),
    ).toBe("اسم العميل الموحّد");
  });
});
