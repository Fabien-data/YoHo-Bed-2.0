import PDFDocument from 'pdfkit';
import type { Voucher } from './voucher';
import type { InvoicesService } from '../finance/invoices.service';

const ink = '#183247';
const muted = '#536675';
const accent = '#176f87';

function createPdf(draw: (pdf: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 48, info: { Creator: 'YoHoBed' } });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('error', reject);
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    draw(pdf);
    pdf.end();
  });
}

function heading(pdf: PDFKit.PDFDocument, property: string, title: string, number: string) {
  pdf.fillColor(accent).font('Helvetica-Bold').fontSize(19).text(property);
  pdf.moveDown(0.2).fillColor(ink).fontSize(16).text(title.toUpperCase());
  pdf.fillColor(muted).font('Helvetica').fontSize(10).text(number);
  pdf.moveDown(0.7).strokeColor('#d8e3e7').moveTo(48, pdf.y).lineTo(547, pdf.y).stroke();
  pdf.moveDown(1);
}

function pair(pdf: PDFKit.PDFDocument, label: string, value: string | number | null | undefined) {
  pdf.fillColor(muted).font('Helvetica').fontSize(9).text(label.toUpperCase());
  pdf
    .fillColor(ink)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(String(value ?? '—'));
  pdf.moveDown(0.55);
}

export function renderVoucherPdf(v: Voucher): Promise<Buffer> {
  return createPdf((pdf) => {
    heading(pdf, v.property.name, 'Reservation voucher', v.reference);
    pair(pdf, 'Guest', v.guest.name);
    pair(pdf, 'Stay', `${v.checkin} to ${v.checkout} · ${v.nights} nights`);
    pair(pdf, 'Status', v.status);
    pdf.moveDown().fillColor(ink).font('Helvetica-Bold').fontSize(12).text('Rooms');
    pdf.moveDown(0.5);
    for (const r of v.rooms) {
      pdf
        .fillColor(ink)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(`${r.roomCode ?? 'Unassigned'} · ${r.roomType}`);
      pdf
        .fillColor(muted)
        .font('Helvetica')
        .fontSize(9)
        .text(
          `${r.adults} adult(s), ${r.children} child(ren)${r.mealPlan ? ` · ${r.mealPlan}` : ''}`,
        );
      pdf.moveDown(0.6);
    }
    pdf
      .moveDown()
      .fillColor(ink)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(`Total: ${v.currency} ${v.total.toFixed(2)}`);
    pdf.text(`Paid: ${v.currency} ${v.paid.toFixed(2)}`);
    pdf.text(`Balance: ${v.currency} ${v.balance.toFixed(2)}`);
    pdf
      .moveDown(1.5)
      .fillColor(muted)
      .font('Helvetica')
      .fontSize(9)
      .text(
        [v.property.address, v.property.city, v.property.phone, v.property.email]
          .filter(Boolean)
          .join(' · '),
      );
  });
}

export function renderInvoicePdf(
  inv: Awaited<ReturnType<InvoicesService['detail']>>,
): Promise<Buffer> {
  return createPdf((pdf) => {
    const lk = inv.profile === 'lk_vat';
    const date = (value: string | null | undefined) => {
      if (!value) return '—';
      const [year, month, day] = value.slice(0, 10).split('-');
      return lk ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
    };
    const money = (value: string | number | null | undefined) =>
      Number(value ?? 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const vat = (items: Array<{ priority: number; name: string; amount: number }> | null) =>
      (items ?? [])
        .filter((item) => item.priority === 3 || /\bvat\b/i.test(item.name))
        .reduce((sum, item) => sum + Number(item.amount), 0);
    const party = (
      label: string,
      value: typeof inv.supplier,
      x: number,
      align: 'left' | 'right',
    ) => {
      if (!value) return;
      const width = 235;
      const write = (text: string, strong = false) => {
        pdf
          .fillColor(strong ? ink : muted)
          .font(strong ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(strong ? 10 : 8)
          .text(text, x, pdf.y, { width, align });
      };
      pdf.y = 118;
      write(label.toUpperCase(), true);
      write(value.name, true);
      if (value.legalName && value.legalName !== value.name) write(value.legalName);
      if (value.address) write(value.address);
      if (value.city || value.country)
        write([value.city, value.country].filter(Boolean).join(', '));
      if (value.phone) write(value.phone);
      if (value.email) write(value.email);
      if (value.taxId) write(`TIN ${value.taxId}`, true);
      if (value.registrationNo) write(`Reg. ${value.registrationNo}`);
    };

    pdf
      .fillColor(accent)
      .font('Helvetica-Bold')
      .fontSize(18)
      .text(inv.title.toUpperCase(), 48, 48, {
        width: 499,
        align: 'center',
      });
    pdf.fillColor(muted).font('Helvetica').fontSize(9).text(inv.number, { align: 'center' });
    party('Supplier', inv.supplier, 48, 'left');
    party('Purchaser', inv.payer, 312, 'right');
    pdf.y = 233;
    pdf.strokeColor('#d8e3e7').moveTo(48, pdf.y).lineTo(547, pdf.y).stroke();
    pdf.moveDown(1);
    const metadata = [
      `Invoice no.  ${inv.number}`,
      `Invoice date  ${date(inv.invoiceDate ?? inv.issuedAt.toISOString())}`,
      `Date of supply  ${date(inv.supplyDate)}`,
      `Booking  ${inv.booking?.reference ?? '—'}`,
    ];
    for (let i = 0; i < metadata.length; i += 2) {
      const y = pdf.y;
      pdf.fillColor(ink).font('Helvetica').fontSize(9).text(metadata[i]!, 48, y, { width: 245 });
      pdf.text(metadata[i + 1]!, 302, y, { width: 245 });
      pdf.y = y + 19;
    }
    if (inv.booking) {
      pdf.text(`Stay  ${date(inv.booking.checkin)} to ${date(inv.booking.checkout)}`, 48, pdf.y);
    }
    if (inv.original) pdf.text(`Against invoice  ${inv.original.number}`, 48, pdf.y);
    if (inv.creditReason) pdf.text(`Reason  ${inv.creditReason}`, 48, pdf.y);
    pdf.moveDown(1);

    const columns = [48, 273, 308, 373, 438, 493];
    const widths = [225, 35, 65, 65, 55, 54];
    const tableHeader = () => {
      const y = pdf.y;
      pdf.rect(48, y, 499, 22).fill('#edf4f6');
      ['Description', 'Qty', 'Unit', lk ? 'Ex VAT' : 'Net', lk ? 'VAT' : 'Tax', 'Total'].forEach(
        (label, i) =>
          pdf
            .fillColor(ink)
            .font('Helvetica-Bold')
            .fontSize(8)
            .text(label, columns[i]!, y + 6, {
              width: widths[i]!,
              align: i === 0 ? 'left' : 'right',
            }),
      );
      pdf.y = y + 26;
    };
    tableHeader();
    for (const line of inv.lines) {
      pdf.font('Helvetica').fontSize(8);
      const rowHeight = Math.max(20, pdf.heightOfString(line.description, { width: 217 }) + 8);
      if (pdf.y + rowHeight > 720) {
        pdf.addPage();
        pdf.y = 48;
        tableHeader();
      }
      const y = pdf.y;
      const lineVat = vat(line.taxLines);
      const cells = [
        line.description,
        String(Number(line.quantity)),
        money(line.unitPrice),
        money(Number(line.amount) - lineVat),
        money(lineVat),
        money(line.amount),
      ];
      cells.forEach((cell, i) =>
        pdf
          .fillColor(ink)
          .font('Helvetica')
          .fontSize(8)
          .text(cell, columns[i]!, y + 3, {
            width: widths[i]! - (i === 0 ? 8 : 0),
            align: i === 0 ? 'left' : 'right',
          }),
      );
      pdf
        .strokeColor('#e5ecee')
        .moveTo(48, y + rowHeight)
        .lineTo(547, y + rowHeight)
        .stroke();
      pdf.y = y + rowHeight + 2;
    }
    if (pdf.y > 665) pdf.addPage();
    pdf.moveDown(1);
    const taxTotal = vat(inv.taxSummary);
    const totals = [
      [`Total value of supply (excl. ${lk ? 'VAT' : 'tax'})`, money(Number(inv.amount) - taxTotal)],
      ...(inv.taxSummary ?? []).map((tax) => [
        `${tax.name} ${(tax.rate * 100).toFixed(0)}%`,
        money(tax.amount),
      ]),
      ...(Number(inv.rounding) !== 0 ? [['Rounding', money(inv.rounding)]] : []),
      ['Total', `${inv.currency} ${money(inv.amount)}`],
    ];
    for (const [label, value] of totals) {
      if (pdf.y > 745) pdf.addPage();
      const y = pdf.y;
      pdf
        .fillColor(ink)
        .font(label === 'Total' ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(9);
      pdf.text(label!, 270, y, { width: 195, align: 'right' });
      pdf.text(value!, 472, y, { width: 75, align: 'right' });
      pdf.y = y + 17;
    }
    if (inv.fxRate && inv.fxQuote) {
      const y = pdf.y + 5;
      pdf
        .font('Helvetica-Bold')
        .text(`Total in ${inv.fxQuote}`, 300, y, { width: 165, align: 'right' });
      pdf.text(`${inv.fxQuote} ${money(Number(inv.amount) * Number(inv.fxRate))}`, 469, y, {
        width: 78,
        align: 'right',
      });
      pdf.y = y + 17;
      pdf
        .fillColor(muted)
        .font('Helvetica')
        .fontSize(8)
        .text(
          `Converted at 1 ${inv.currency} = ${Number(inv.fxRate).toFixed(4)} ${inv.fxQuote} on ${date(inv.invoiceDate)}.`,
          48,
          pdf.y,
          { width: 499, align: 'right' },
        );
    }
    if (inv.notes) {
      if (pdf.y > 715) pdf.addPage();
      pdf
        .fillColor(muted)
        .font('Helvetica')
        .fontSize(8)
        .text(inv.notes, 48, pdf.y + 18, { width: 499 });
    }
    if (inv.creditedAt && inv.kind !== 'credit_note') {
      if (pdf.y > 725) pdf.addPage();
      pdf
        .fillColor('#9c2d2d')
        .text(`Cancelled by credit note ${inv.creditNotes[0]?.number ?? ''}.`, 48, pdf.y + 14, {
          width: 499,
        });
    }
    if (pdf.y > 745) pdf.addPage();
    pdf
      .fillColor(muted)
      .fontSize(8)
      .text(
        `Computer-generated document.${lk ? ' Issued under Gazette 2481/22.' : ''}`,
        48,
        pdf.y + 16,
        { width: 499, align: 'center' },
      );
  });
}
