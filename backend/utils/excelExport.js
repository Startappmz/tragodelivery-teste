const ExcelJS = require('exceljs');

exports.generateFinancialReport = async (data) => {
  const { expenses, orders, drivers, startDate, endDate } = data;

  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Resumo Geral
  const summarySheet = workbook.addWorksheet('Resumo Geral');
  summarySheet.columns = [
    { header: 'Métrica', key: 'metric', width: 30 },
    { header: 'Valor (MZN)', key: 'value', width: 20 }
  ];

  const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);
  const totalRevenue = orders.reduce((sum, ord) => sum + ord.price, 0);
  const totalProfit = orders.reduce((sum, ord) => sum + ord.valor_empresa, 0);
  const totalDriverEarnings = orders.reduce((sum, ord) => sum + ord.valor_motorista, 0);

  summarySheet.addRows([
    { metric: 'Período', value: `${startDate} a ${endDate}` },
    { metric: 'Total de Receita', value: totalRevenue.toFixed(2) },
    { metric: 'Total de Custos', value: totalExpenses.toFixed(2) },
    { metric: 'Lucro da Empresa', value: totalProfit.toFixed(2) },
    { metric: 'Ganhos dos Motoristas', value: totalDriverEarnings.toFixed(2) },
    { metric: 'Lucro Líquido (Receita - Custos)', value: (totalRevenue - totalExpenses).toFixed(2) }
  ]);

  summarySheet.getRow(1).font = { bold: true };

  // Sheet 2: Custos Detalhados
  const expensesSheet = workbook.addWorksheet('Custos');
  expensesSheet.columns = [
    { header: 'Data', key: 'date', width: 15 },
    { header: 'Categoria', key: 'category', width: 20 },
    { header: 'Descrição', key: 'description', width: 30 },
    { header: 'Funcionário', key: 'employee', width: 25 },
    { header: 'Valor (MZN)', key: 'amount', width: 15 }
  ];

  expenses.forEach((exp) => {
    expensesSheet.addRow({
      date: new Date(exp.date).toLocaleDateString('pt-MZ'),
      category: exp.category,
      description: exp.description,
      employee: exp.employee ? exp.employee.nome : 'N/A',
      amount: exp.amount.toFixed(2)
    });
  });

  expensesSheet.getRow(1).font = { bold: true };

  // Sheet 3: Pedidos
  const ordersSheet = workbook.addWorksheet('Pedidos');
  ordersSheet.columns = [
    { header: 'ID Pedido', key: 'orderId', width: 15 },
    { header: 'Cliente', key: 'client', width: 25 },
    { header: 'Motorista', key: 'driver', width: 25 },
    { header: 'Natureza', key: 'service', width: 20 },
    { header: 'Valor Total (MZN)', key: 'price', width: 18 },
    { header: 'Lucro Empresa (MZN)', key: 'profit', width: 18 },
    { header: 'Ganho Motorista (MZN)', key: 'driverEarning', width: 20 },
    { header: 'Data Conclusão', key: 'completedDate', width: 18 }
  ];

  orders.forEach((order) => {
    ordersSheet.addRow({
      orderId: `#${order._id.toString().slice(-6)}`,
      client: order.client_name,
      driver: order.assigned_to_driver ? order.assigned_to_driver.user.nome : 'N/A',
      service: order.service_type,
      price: order.price.toFixed(2),
      profit: order.valor_empresa.toFixed(2),
      driverEarning: order.valor_motorista.toFixed(2),
      completedDate: order.timestamp_completed
        ? new Date(order.timestamp_completed).toLocaleDateString('pt-MZ')
        : 'N/A'
    });
  });

  ordersSheet.getRow(1).font = { bold: true };

  // Sheet 4: Motoristas
  const driversSheet = workbook.addWorksheet('Motoristas');
  driversSheet.columns = [
    { header: 'Nome', key: 'name', width: 25 },
    { header: 'Telefone', key: 'phone', width: 18 },
    { header: 'Viatura', key: 'plate', width: 15 },
    { header: 'Comissão (%)', key: 'commission', width: 15 },
    { header: 'Estado', key: 'status', width: 15 }
  ];

  drivers.forEach((driver) => {
    driversSheet.addRow({
      name: driver.nome,
      phone: driver.telefone,
      plate: driver.profile ? driver.profile.vehicle_plate : 'N/A',
      commission: driver.profile ? driver.profile.commissionRate : 'N/A',
      status: driver.profile ? driver.profile.status : 'N/A'
    });
  });

  driversSheet.getRow(1).font = { bold: true };

  return workbook;
};