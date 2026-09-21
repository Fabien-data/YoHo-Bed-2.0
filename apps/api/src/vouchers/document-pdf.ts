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
    heading(pdf, inv.supplier?.name ?? 'YoHoBed property', inv.title, inv.number);
    pair(pdf, 'Issued', inv.invoiceDate ?? inv.issuedAt.toISOString().slice(0, 10));
    pair(pdf, 'Bill to', inv.payer?.name ?? inv.booking?.guestName ?? 'Guest');
    if (inv.booking)
      pair(
        pdf,
        'Reservation',
        `${inv.booking.reference} · ${inv.booking.checkin} to ${inv.booking.checkout}`,
      );
    if (inv.supplier?.address) pair(pdf, 'Supplier', inv.supplier.address);
    pdf.moveDown().fillColor(ink).font('Helvetica-Bold').fontSize(12).text('Charges');
    pdf.moveDown(0.5);
    for (const line of inv.lines) {
      if (pdf.y > 730) pdf.addPage();
      pdf
        .fillColor(ink)
        .font('Helvetica')
        .fontSize(9)
        .text(`${line.description}  × ${line.quantity}`, 48, pdf.y, {
          width: 390,
          continued: true,
        });
      pdf.font('Helvetica-Bold').text(`${inv.currency} ${line.amount}`, { align: 'right' });
      pdf.moveDown(0.35);
    }
    pdf.moveDown().strokeColor('#d8e3e7').moveTo(48, pdf.y).lineTo(547, pdf.y).stroke();
    pdf
      .moveDown()
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(`Total: ${inv.currency} ${inv.amount}`, { align: 'right' });
    if (inv.taxSummary)
      for (const tax of inv.taxSummary)
        pdf
          .fillColor(muted)
          .font('Helvetica')
          .fontSize(9)
          .text(`${tax.name}: ${inv.currency} ${tax.amount}`, { align: 'right' });
    if (inv.notes) pdf.moveDown().fillColor(muted).fontSize(9).text(inv.notes);
  });
}
