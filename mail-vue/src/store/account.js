    import { defineStore } from 'pinia'

export const useAccountStore = defineStore('account', {
    state: () => ({
        currentAccountId: 0,
        currentAccount: {},
        changeUserAccountName: '',
        viewAll: true,
        accounts: []
    }),
    getters: {
        receiveAll(state) {
            return state.viewAll ? 1 : (state.currentAccount?.allReceive || 0)
        }
    }
})