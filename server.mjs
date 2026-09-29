import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);
const app = express();
app.use(cors());

const STARLINK_CREDENTIALS = [
  {
    name: 'PUSPALAD 01',
    clientId: '6b3b899c-c576-4e26-8e91-dcc28d343df2',
    clientSecret: 'spx_df_bY1tGPLRjLHuEmXa-0znSZIZdLm-xFgs1qY2LrxdYezUdys1'
  },
  {
    name: 'PUSPALAD 02',
    clientId: '25a2ff81-f117-4032-99a2-a725ecd9ef35',
    clientSecret: 'spx_df_Vpba2Kkrt7Vjboejdhl4en37w02pf9m2EKSWq7UXxiW_4ZIA'
  },
  {
    name: 'PUSPALAD 06',
    clientId: '8a2d5796-b8d0-4484-9b6d-4a40774aa2fc',
    clientSecret: 'spx_df_rQC-AkWrIbH7lflQBtbEL9fPRKZ6jqTiTHhky_5WHMvn2-3y'
  },
  {
    name: 'PUSPALAD 13',
    clientId: '26a81ca7-918d-486a-b2c3-de605869ea58',
    clientSecret: 'spx_df_FIGxHVduWbwm0fx_AIom1wXDQonzSgkn0ZCWnQF-5AalAoZH'
  },
  {
    name: 'PUSPALAD 25',
    clientId: '16facb22-b1db-4b8f-90f9-ddc04d68007b',
    clientSecret: 'spx_df_YLI32UfPuIiLk8Aq-Md7XIC2AzwsEpCh-t_yeAYsSvhCN1Sf'
  }
];

async function fetchAccountIsolated(cred) {
  try {
    const cmd = `node fetch_worker.mjs "${cred.clientId}" "${cred.clientSecret}" "${cred.name}"`;
    const { stdout } = await execPromise(cmd);
    return JSON.parse(stdout.trim() || '[]');
  } catch (err) {
    console.error(`Error worker [${cred.name}]:`, err.message);
    return [];
  }
}

app.get('/api/starlink/dashboard', async (req, res) => {
  try {
    let allNodes = [];
    let nodeIndexCounter = 1;

    const promises = STARLINK_CREDENTIALS.map(cred => fetchAccountIsolated(cred));
    const results = await Promise.all(promises);

    results.forEach((nodes) => {
      nodes.forEach((node) => {
        node.no = nodeIndexCounter++;
        allNodes.push(node);
      });
    });

    const activeNodes = allNodes.filter(d => d.serviceStatus === 'ACTIVE').length;
    const suspendedNodes = allNodes.filter(d => d.serviceStatus === 'SUSPENDED').length;
    const dismantledNodes = allNodes.filter(d => d.serviceStatus === 'DISMANTLED' || d.serviceStatus === 'INACTIVE').length;

    const onlineNodes = allNodes.filter(d => d.deviceStatus === 'Online').length;
    const offlineNodes = allNodes.filter(d => d.deviceStatus === 'Offline').length;

    const usageUnder75 = allNodes.filter(d => d.percentUsage < 75).length;
    const usage75To100 = allNodes.filter(d => d.percentUsage >= 75 && d.percentUsage < 100).length;
    const usageOver100 = allNodes.filter(d => d.percentUsage >= 100).length;

    res.json({
      summary: {
        active: activeNodes,
        suspended: suspendedNodes,
        dismantled: dismantledNodes,
        online: onlineNodes,
        offline: offlineNodes,
        usageUnder75: usageUnder75,
        usage75To100: usage75To100,
        usageOver100: usageOver100,
      },
      nodes: allNodes
    });

  } catch (error) {
    console.error('Error server:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server API Multi-Account Starlink berjalan di port ${PORT}`);
});

// Fungsi pembantu untuk mengelompokkan dailyUsage menjadi monthlyUsage
function calculateMonthlyUsage(dailyUsage = []) {
  const monthlyMap = {};

  dailyUsage.forEach(item => {
    // Ambil format YYYY-MM dari tanggal (contoh: "2026-06")
    const dateStr = item.day || item.date || item.timestamp;
    if (!dateStr) return;
    
    const monthKey = dateStr.substring(0, 7); // "2026-06"
    const usageVal = Number(item.dailyGb || item.gb || item.usage || 0);

    if (!monthlyMap[monthKey]) {
      monthlyMap[monthKey] = 0;
    }
    monthlyMap[monthKey] += usageVal;
  });

  // Ubah ke format Array [{ month: "Jun 2026", totalGb: 150.5 }, ...]
  return Object.keys(monthlyMap).map(key => {
    const [year, month] = key.split('-');
    const dateObj = new Date(year, month - 1);
    const monthName = dateObj.toLocaleString('en-US', { month: 'short', year: 'numeric' });
    
    return {
      monthKey: key,
      month: monthName,
      totalGb: parseFloat(monthlyMap[key].toFixed(2))
    };
  });
}
