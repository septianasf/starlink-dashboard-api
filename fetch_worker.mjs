import { StarlinkAPI } from '@gibme/starlink/enterprise';

const clientId = process.argv[2];
const clientSecret = process.argv[3];
const credName = process.argv[4];

async function run() {
  try {
    const api = new StarlinkAPI(clientId, clientSecret);
    const accounts = await api.fetch_accounts();
    if (!accounts || accounts.length === 0) {
      console.log(JSON.stringify([]));
      return;
    }

    const account = accounts[0];
    const tracking = await account.fetch_realtime_data_tracking().catch(() => []);

    let serviceLines = [];
    try {
      if (typeof account.fetch_service_lines === 'function') {
        serviceLines = await account.fetch_service_lines();
      }
    } catch (e) {}

    let userTerminals = [];
    try {
      if (typeof account.fetch_user_terminals === 'function') {
        userTerminals = await account.fetch_user_terminals();
      }
    } catch (e) {}

    // =========================================================
    // AMBIL DATA ALAMAT BERDASARKAN addressReferenceId
    // =========================================================
    let addresses = [];
    try {
      if (typeof account.fetch_addresses === 'function') {
        addresses = await account.fetch_addresses();
      } else if (typeof account.get_addresses === 'function') {
        addresses = await account.get_addresses();
      }
    } catch (e) {}

    const itemsToMap = (tracking && tracking.length > 0) ? tracking : serviceLines;

    const results = itemsToMap.map(item => {
      const slNumber = item.serviceLineNumber || item.serviceLine?.serviceLineNumber || 'N/A';
      const matchedSl = serviceLines.find(s => s.serviceLineNumber === slNumber) || item;
      const matchedUt = userTerminals.find(u => u.serviceLineNumber === slNumber || u.userTerminalId === item.servicePlan?.dataPoolUsage?.userTerminalId);

      // Cari alamat yang cocok menggunakan addressReferenceId
      const targetAddressId = matchedSl.addressReferenceId || item.addressReferenceId || matchedSl.serviceAddressReferenceId;
      const matchedAddr = addresses.find(a => a.addressReferenceId === targetAddressId || a.id === targetAddressId) || {};

      // Utamakan credName jika nickname dari API hanya bernilai umum (seperti "PUSPALAD")
      let nickname = matchedSl.nickname || matchedSl.serviceLineName || credName;
      if (!nickname || nickname.trim() === 'PUSPALAD') {
        nickname = credName;
      }

      let kitSerialNumber = matchedUt?.kitSerialNumber || matchedUt?.userTerminalId || item.kitSerialNumber;

      if (!kitSerialNumber || kitSerialNumber.length > 20) {
        if (item.servicePlan?.dataPoolUsage?.userTerminalId) {
          kitSerialNumber = 'KIT' + item.servicePlan.dataPoolUsage.userTerminalId.replace(/-/g, '').toUpperCase().substring(0, 12);
        } else {
          kitSerialNumber = matchedUt?.kitSerialNumber || 'N/A';
        }
      }

      const activeBc = item.billingCycles?.find(bc => bc.dailyDataUsage && bc.dailyDataUsage.length > 0) || item.billingCycles?.[0] || matchedSl.billingCycles?.[0];
      const dailyDataRaw = activeBc?.dailyDataUsage || [];

      // =========================================================
      // EKSTRAKSI TANGGAL DAN BULAN PERIODE TAGIHAN
      // =========================================================
      const startDateRaw = activeBc?.startDate || item.startDate || matchedSl.startDate || '';
      const endDateRaw = activeBc?.endDate || item.endDate || matchedSl.endDate || '';

      const formatDate = (dStr) => {
        if (!dStr) return '-';
        const d = new Date(dStr);
        return isNaN(d.getTime()) ? dStr.substring(0, 10) : d.toISOString().split('T')[0];
      };

      const startDateFormatted = formatDate(startDateRaw);
      const endDateFormatted = formatDate(endDateRaw);

      const periodLabel = (startDateFormatted !== '-' && endDateFormatted !== '-')
        ? `${startDateFormatted} s/d ${endDateFormatted}`
        : (startDateFormatted !== '-' ? startDateFormatted : 'N/A');

      const dailyData = dailyDataRaw.map(day => {
        const priorityVal = Number(day.priorityGB || day.localPriorityGB || 0);
        const standardVal = Number(day.standardGB || day.otherGB || 0);
        const totalDayVal = Math.round((priorityVal + standardVal) * 100) / 100;

        return {
          date: day.date,
          priorityGB: priorityVal,
          standardGB: standardVal,
          totalGB: totalDayVal
        };
      });

      // =========================================================
      // EKSTRAKSI WAKTU LAST UPDATE
      // =========================================================
      const lastDailyRecord = dailyDataRaw && dailyDataRaw.length > 0 
        ? dailyDataRaw[dailyDataRaw.length - 1] 
        : null;

      const rawLastUpdate = 
        item.lastUpdate ||
        item.updatedAt ||
        item.lastCommunicationTime ||
        item.timestamp ||
        matchedUt?.lastUpdate ||
        matchedUt?.updatedAt ||
        lastDailyRecord?.date ||
        null;

      let lastUpdateFormatted = 'N/A';
      if (rawLastUpdate) {
        const d = new Date(rawLastUpdate);
        if (!isNaN(d.getTime())) {
          lastUpdateFormatted = d.toLocaleString('id-ID', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          }).replace(/\//g, '-');
        } else {
          lastUpdateFormatted = String(rawLastUpdate);
        }
      }

      let localPriorityGB = activeBc?.priorityGBUsed 
        || item.servicePlan?.dataPoolUsage?.consumedAmountGB 
        || dailyData.reduce((acc, d) => acc + d.priorityGB, 0);

      let otherDataGB = activeBc?.standardGBUsed 
        || dailyData.reduce((acc, d) => acc + d.standardGB, 0);

      localPriorityGB = Math.round(localPriorityGB * 100) / 100;
      otherDataGB = Math.round(otherDataGB * 100) / 100;

      const totalDataUsageGB = Math.round((localPriorityGB + otherDataGB) * 100) / 100;
      let limitGB = item.servicePlan?.usageLimitGB || 50;

      const percentUsage = limitGB > 0 ? Math.min(100, Math.round((localPriorityGB / limitGB) * 100)) : 0;

      let deviceStatus = 'Offline';
      const isExplicitOnline = item.online === true || matchedUt?.connected === true || item.deviceState === 'CONNECTED' || item.state === 'ONLINE';
      const isExplicitOffline = item.online === false || matchedUt?.connected === false || item.deviceState === 'OFFLINE' || matchedUt?.unreachable === true;

      if (isExplicitOnline) {
        deviceStatus = 'Online';
      } else if (isExplicitOffline) {
        deviceStatus = 'Offline';
      } else {
        if (matchedSl.active !== false && (localPriorityGB > 0 || otherDataGB > 0 || dailyData.length > 0)) {
          deviceStatus = 'Online';
        } else {
          deviceStatus = 'Offline';
        }
      }

      // Extract latitude & longitude dari objek alamat terasosiasi
      const rawLat = matchedAddr.latitude ?? 
                     matchedAddr.coordinates?.latitude ?? 
                     matchedAddr.location?.latitude ?? 
                     item.latitude ?? 
                     matchedSl.latitude ?? 
                     null;

      const rawLng = matchedAddr.longitude ?? 
                     matchedAddr.coordinates?.longitude ?? 
                     matchedAddr.location?.longitude ?? 
                     item.longitude ?? 
                     matchedSl.longitude ?? 
                     null;

      const parsedLat = (rawLat !== null && !isNaN(Number(rawLat))) ? Number(rawLat) : -4.54680;
      const parsedLng = (rawLng !== null && !isNaN(Number(rawLng))) ? Number(rawLng) : 136.88380;

      return {
        accountGroup: credName,
        nickname: nickname,
        serviceLineNumber: slNumber,
        kitId: kitSerialNumber,
        serviceStatus: 'ACTIVE',
        deviceStatus: deviceStatus,
        lastUpdate: lastUpdateFormatted,        // Kolom Last Update baru menggantikan lastOnline
        period: periodLabel,                   // Menampilkan teks "2026-09-14 s/d 2026-10-14"
        billingCycleStart: startDateFormatted, // Tanggal mulai periode
        billingCycleEnd: endDateFormatted,     // Tanggal selesai periode
        limitGB: limitGB,
        percentUsage: percentUsage,
        localPriorityGB: localPriorityGB,
        otherDataGB: otherDataGB,
        totalDataUsageGB: totalDataUsageGB,
        latitude: parsedLat,
        longitude: parsedLng,
        dailyUsage: dailyData
      };
    });

    console.log(JSON.stringify(results));
  } catch (err) {
    console.log(JSON.stringify([]));
  }
}

run();
