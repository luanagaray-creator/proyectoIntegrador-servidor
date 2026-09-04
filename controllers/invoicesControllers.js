const data = require('../data/invoicesData.js');
 
function getInvoices(req, res) {
    res.json(data.invoices)
}

function getInvoiceById(req, res) {
    const invoiceId = parseInt(req.params.id);
    const invoice = data.invoices.find(i => i.id === invoiceId);
    if (invoice) {
        res.json(invoice);
    }
    else {
        res.status(404).json({ error: 'Factura no encontrada' });
    }
}

function createInvoice(req, res) {
    const { id, usuarioId, monto } = req.body;
    const newInvoice = { id, usuarioId, monto };
    data.invoices.push(newInvoice);
    res.status(201).json(newInvoice);
}

function updateInvoice(req, res) {  
    const invoiceId = parseInt(req.params.id);
    const invoice = data.invoices.find(i => i.id === invoiceId);
    if (invoice) {
        const { usuarioId, monto } = req.body;
        invoice.usuarioId = usuarioId || invoice.usuarioId;
        invoice.monto = monto || invoice.monto;
        res.json(invoice);
    }
    else {
        res.status(404).json({ error: 'Factura no encontrada' });
    }
}

function deleteInvoice(req, res) {
    const invoiceId = parseInt(req.params.id);
    const invoiceIndex = data.invoices.findIndex(i => i.id === invoiceId);
    if (invoiceIndex !== -1) {
        const deletedInvoice = data.invoices.splice(invoiceIndex, 1);
        res.json(deletedInvoice[0]);
    }
    else {
        res.status(404).json({ error: 'Factura no encontrada' });
    }
}

export { getInvoices, getInvoiceById, createInvoice, updateInvoice, deleteInvoice };